import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterSessionCodec,
} from "@nessie/adapter-utils";

// Server-side execution module for the openai-compatible adapter.
//
// Wire shape (Phase 1 v1):
//   - one POST per execute(), no streaming yet
//   - body is a 1-2 message OpenAI Chat Completions payload built from
//     systemPrompt + the heartbeat prompt context
//   - response usage block lifts to AdapterExecutionResult.usage
//   - costUsd / billingType returned so cost_events can attribute spend
//
// Fuller streaming (SSE pass-through), tool-call round-trips, and
// reviewer-pattern wakeup integrate with heartbeat in Phase 2+.

const DEFAULT_PROXY_URL = "http://127.0.0.1:7777/v1";

interface OpenAiAdapterConfig {
  model?: string;
  tier?: "T1" | "T2" | "T3";
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  proxyUrl?: string;
  operatorTriggered?: boolean;
}

function readConfig(raw: unknown): OpenAiAdapterConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  return {
    model: typeof obj.model === "string" ? obj.model : undefined,
    tier:
      obj.tier === "T1" || obj.tier === "T2" || obj.tier === "T3" ? obj.tier : undefined,
    systemPrompt: typeof obj.systemPrompt === "string" ? obj.systemPrompt : undefined,
    temperature: typeof obj.temperature === "number" ? obj.temperature : undefined,
    maxTokens: typeof obj.maxTokens === "number" ? obj.maxTokens : undefined,
    proxyUrl: typeof obj.proxyUrl === "string" ? obj.proxyUrl : undefined,
    operatorTriggered: typeof obj.operatorTriggered === "boolean" ? obj.operatorTriggered : undefined,
  };
}

function readPromptFromContext(context: Record<string, unknown>): string {
  const prompt = context.prompt;
  if (typeof prompt === "string" && prompt.trim().length > 0) return prompt;
  // The heartbeat may pass a full payload; serialize the relevant subset.
  return JSON.stringify(context);
}

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const config = readConfig(ctx.agent.adapterConfig);
  const proxyBase = (config.proxyUrl ?? process.env.NESSIE_PROXY_URL ?? DEFAULT_PROXY_URL).replace(/\/+$/, "");
  const model = config.model;
  if (!model) {
    return failResult("missing_model", "openai_compatible adapter requires `model` on adapterConfig");
  }

  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-nessie-agent-id": ctx.agent.id,
    "x-nessie-company-id": ctx.agent.companyId,
    "x-nessie-heartbeat-run-id": ctx.runId,
  };
  if (config.tier) headers["x-nessie-tier"] = config.tier;
  if (config.operatorTriggered) headers["x-nessie-operator-triggered"] = "true";

  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (config.systemPrompt) messages.push({ role: "system", content: config.systemPrompt });
  messages.push({ role: "user", content: readPromptFromContext(ctx.context) });

  const body = {
    model,
    messages,
    temperature: config.temperature ?? 0.2,
    max_tokens: config.maxTokens,
    stream: false,
  };

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(`${proxyBase}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.onLog("stderr", `proxy fetch failed: ${message}\n`);
    return failResult("transport_error", message);
  }

  const latencyMs = Date.now() - startedAt;
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    await ctx.onLog("stderr", `non-JSON response from proxy (HTTP ${res.status})\n${text.slice(0, 1000)}\n`);
    return failResult("non_json", `proxy returned non-JSON, HTTP ${res.status}`);
  }

  if (!res.ok) {
    const errBody = parsed as { error?: { message?: string; type?: string } };
    const msg = errBody?.error?.message ?? `HTTP ${res.status}`;
    await ctx.onLog("stderr", `proxy ${res.status}: ${msg}\n`);
    return failResult(errBody?.error?.type ?? `http_${res.status}`, msg);
  }

  const completion = parsed as {
    id?: string;
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; cached_input_tokens?: number };
  };
  const assistantText = completion.choices?.[0]?.message?.content ?? "";
  if (assistantText) {
    await ctx.onLog("stdout", assistantText + "\n");
  }

  const usage = completion.usage ?? {};
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    usage: {
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      cachedInputTokens: usage.cached_input_tokens ?? 0,
    },
    sessionId: completion.id ?? null,
    sessionParams: completion.id ? { sessionId: completion.id } : null,
    sessionDisplayId: completion.id ?? null,
    provider: "nessie_proxy",
    biller: "nessie_proxy",
    model,
    billingType: "metered_api",
    summary: assistantText.slice(0, 200) || null,
    resultJson: { latencyMs, finishReason: completion.choices?.[0]?.finish_reason ?? null },
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

export async function testEnvironment(_ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
  const proxyBase = (process.env.NESSIE_PROXY_URL ?? DEFAULT_PROXY_URL).replace(/\/+$/, "");
  try {
    const res = await fetch(`${proxyBase}/health`, { signal: AbortSignal.timeout(3_000) });
    if (res.ok) {
      return {
        adapterType: "openai_compatible",
        status: "pass",
        checks: [
          { code: "proxy_reachable", level: "info", message: `Nessie proxy reachable at ${proxyBase}` },
        ],
        testedAt: new Date().toISOString(),
      };
    }
    return {
      adapterType: "openai_compatible",
      status: "warn",
      checks: [
        { code: "proxy_unhealthy", level: "warn", message: `Nessie proxy returned HTTP ${res.status}` },
      ],
      testedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      adapterType: "openai_compatible",
      status: "fail",
      checks: [
        { code: "proxy_unreachable", level: "error", message: `Could not reach Nessie proxy: ${message}` },
      ],
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
