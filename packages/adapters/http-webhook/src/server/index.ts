import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterSessionCodec,
} from "@nessie/adapter-utils";

interface HttpWebhookConfig {
  url?: string;
  bearerToken?: string;
  bearerTokenEnv?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  healthUrl?: string;
}

function readConfig(raw: unknown): HttpWebhookConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  return {
    url: typeof obj.url === "string" ? obj.url : undefined,
    bearerToken: typeof obj.bearerToken === "string" ? obj.bearerToken : undefined,
    bearerTokenEnv: typeof obj.bearerTokenEnv === "string" ? obj.bearerTokenEnv : undefined,
    headers:
      typeof obj.headers === "object" && obj.headers !== null && !Array.isArray(obj.headers)
        ? (obj.headers as Record<string, string>)
        : undefined,
    timeoutMs: typeof obj.timeoutMs === "number" ? obj.timeoutMs : undefined,
    healthUrl: typeof obj.healthUrl === "string" ? obj.healthUrl : undefined,
  };
}

function resolveBearer(config: HttpWebhookConfig): string | null {
  if (config.bearerTokenEnv) {
    const value = process.env[config.bearerTokenEnv]?.trim();
    if (value) return value;
  }
  return config.bearerToken?.trim() ?? null;
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const config = readConfig(ctx.agent.adapterConfig);
  if (!config.url) {
    return failResult("missing_url", "http_webhook adapter requires `url` on adapterConfig");
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-nessie-agent-id": ctx.agent.id,
    "x-nessie-company-id": ctx.agent.companyId,
    "x-nessie-heartbeat-run-id": ctx.runId,
    ...(config.headers ?? {}),
  };
  const bearer = resolveBearer(config);
  if (bearer) headers["authorization"] = `Bearer ${bearer}`;

  const body = {
    runId: ctx.runId,
    agent: { id: ctx.agent.id, companyId: ctx.agent.companyId, name: ctx.agent.name },
    runtime: ctx.runtime,
    context: ctx.context,
  };

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(config.url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(config.timeoutMs ?? 60_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.onLog("stderr", `webhook fetch failed: ${message}\n`);
    return failResult("transport_error", message);
  }

  const latencyMs = Date.now() - startedAt;
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : {};
  } catch {
    await ctx.onLog("stderr", `non-JSON webhook response (HTTP ${res.status})\n`);
    return failResult("non_json", `webhook returned non-JSON, HTTP ${res.status}`);
  }

  if (!res.ok) {
    const msg =
      parsed && typeof parsed === "object" && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : `HTTP ${res.status}`;
    return failResult(`http_${res.status}`, msg);
  }

  const response = (parsed ?? {}) as {
    summary?: string;
    outputText?: string;
    sessionId?: string;
    usage?: { inputTokens?: number; outputTokens?: number; cachedInputTokens?: number };
    costUsd?: number;
    metadata?: Record<string, unknown>;
  };

  if (response.outputText) await ctx.onLog("stdout", response.outputText + "\n");

  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    usage: response.usage
      ? {
          inputTokens: response.usage.inputTokens ?? 0,
          outputTokens: response.usage.outputTokens ?? 0,
          cachedInputTokens: response.usage.cachedInputTokens ?? 0,
        }
      : undefined,
    sessionId: response.sessionId ?? null,
    sessionParams: response.sessionId ? { sessionId: response.sessionId } : null,
    sessionDisplayId: response.sessionId ?? null,
    provider: "http_webhook",
    biller: new URL(config.url).host,
    billingType: typeof response.costUsd === "number" ? "metered_api" : "unknown",
    costUsd: typeof response.costUsd === "number" ? response.costUsd : null,
    summary: response.summary ?? response.outputText?.slice(0, 200) ?? null,
    resultJson: { latencyMs, metadata: response.metadata ?? null },
  };
}

function failResult(code: string, message: string): AdapterExecutionResult {
  return {
    exitCode: 1,
    signal: null,
    timedOut: false,
    errorCode: code,
    errorMessage: message,
  };
}

export async function testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
  const config = readConfig(ctx.config);
  if (!config.url) {
    return {
      adapterType: "http_webhook",
      status: "fail",
      checks: [{ code: "missing_url", level: "error", message: "agent.adapterConfig.url is required" }],
      testedAt: new Date().toISOString(),
    };
  }
  const probeUrl = config.healthUrl ?? config.url;
  try {
    const res = await fetch(probeUrl, {
      method: config.healthUrl ? "GET" : "OPTIONS",
      signal: AbortSignal.timeout(3_000),
    });
    return {
      adapterType: "http_webhook",
      status: res.ok ? "pass" : "warn",
      checks: [
        {
          code: res.ok ? "webhook_reachable" : "webhook_unhealthy",
          level: res.ok ? "info" : "warn",
          message: `Probe HTTP ${res.status} from ${probeUrl}`,
        },
      ],
      testedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      adapterType: "http_webhook",
      status: "fail",
      checks: [{ code: "webhook_unreachable", level: "error", message }],
      testedAt: new Date().toISOString(),
    };
  }
}

export const sessionCodec: AdapterSessionCodec = {
  deserialize(raw) {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
    const obj = raw as Record<string, unknown>;
    const sessionId = typeof obj.sessionId === "string" ? obj.sessionId : null;
    return sessionId ? { sessionId } : null;
  },
  serialize(params) {
    if (!params) return null;
    const sessionId = typeof params.sessionId === "string" ? params.sessionId : null;
    return sessionId ? { sessionId } : null;
  },
  getDisplayId(params) {
    if (!params) return null;
    return typeof params.sessionId === "string" ? params.sessionId : null;
  },
};
