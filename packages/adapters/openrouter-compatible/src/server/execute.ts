import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterSessionCodec,
} from "@nessie/adapter-utils";
import {
  DEFAULT_OPENROUTER_BASE_URL,
  requireOpenRouterModelId,
  testOpenRouterEnvironment,
} from "./models.js";

interface OpenRouterAdapterConfig {
  model?: string;
  baseUrl?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

function readConfig(raw: unknown): OpenRouterAdapterConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  return {
    model: typeof obj.model === "string" ? obj.model : undefined,
    baseUrl: typeof obj.baseUrl === "string" ? obj.baseUrl : undefined,
    systemPrompt: typeof obj.systemPrompt === "string" ? obj.systemPrompt : undefined,
    temperature: typeof obj.temperature === "number" ? obj.temperature : undefined,
    maxTokens: typeof obj.maxTokens === "number" ? obj.maxTokens : undefined,
  };
}

function readPromptFromContext(context: Record<string, unknown>): string {
  const prompt = context.prompt;
  if (typeof prompt === "string" && prompt.trim().length > 0) return prompt;
  return JSON.stringify(context);
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveApiKey(config: OpenRouterAdapterConfig): string | null {
  const apiKey = readNonEmptyString(process.env.OPENROUTER_API_KEY);
  if (apiKey) return apiKey;
  return null;
}

function resolveBaseUrl(config: OpenRouterAdapterConfig): string {
  return (config.baseUrl ?? process.env.OPENROUTER_BASE_URL ?? DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, "");
}

function buildHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const referer = readNonEmptyString(process.env.OPENROUTER_HTTP_REFERER);
  if (referer) headers["HTTP-Referer"] = referer;
  const title =
    readNonEmptyString(process.env.OPENROUTER_X_TITLE)
    ?? readNonEmptyString(process.env.OPENROUTER_TITLE);
  if (title) headers["X-OpenRouter-Title"] = title;
  return headers;
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

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const config = readConfig(ctx.agent.adapterConfig);
  const model = requireOpenRouterModelId(config.model);
  const apiKey = resolveApiKey(config);
  if (!apiKey) {
    return failResult("openrouter_api_key_missing", "OpenRouter API key is missing. Set OPENROUTER_API_KEY.");
  }

  const baseUrl = resolveBaseUrl(config);
  const headers = buildHeaders(apiKey);
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
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.onLog("stderr", `OpenRouter request failed: ${message}\n`);
    return failResult("openrouter_transport_error", message);
  }

  const latencyMs = Date.now() - startedAt;
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    await ctx.onLog("stderr", `non-JSON response from OpenRouter (HTTP ${res.status})\n${text.slice(0, 1000)}\n`);
    return failResult("openrouter_non_json", `OpenRouter returned non-JSON, HTTP ${res.status}`);
  }

  if (!res.ok) {
    const errBody = parsed as { error?: { message?: string; type?: string } };
    const msg = errBody?.error?.message ?? `HTTP ${res.status}`;
    await ctx.onLog("stderr", `OpenRouter ${res.status}: ${msg}\n`);
    return failResult(errBody?.error?.type ?? `openrouter_http_${res.status}`, msg);
  }

  const completion = parsed as {
    id?: string;
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cached_input_tokens?: number;
    };
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
    provider: "openrouter",
    biller: "openrouter",
    model,
    billingType: "api",
    summary: assistantText.slice(0, 200) || null,
    resultJson: {
      latencyMs,
      finishReason: completion.choices?.[0]?.finish_reason ?? null,
    },
  };
}

export async function testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
  return testOpenRouterEnvironment({
    ...ctx,
    config: ctx.config as Record<string, unknown>,
  });
}

export const sessionCodec: AdapterSessionCodec = {
  deserialize() {
    return null;
  },
  serialize() {
    return null;
  },
  getDisplayId() {
    return null;
  },
};
