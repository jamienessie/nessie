import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterSessionCodec,
} from "@nessie/adapter-utils";
import {
  DEFAULT_GEMINI_BASE_URL,
  isFreeTierGeminiModel,
  requireGeminiModelId,
  testGeminiEnvironment,
} from "./models.js";

interface GeminiAdapterConfig {
  model?: string;
  baseUrl?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  env?: Record<string, unknown>;
}

function readConfig(raw: unknown): GeminiAdapterConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  const env = typeof obj.env === "object" && obj.env !== null && !Array.isArray(obj.env)
    ? (obj.env as Record<string, unknown>)
    : undefined;
  return {
    model: typeof obj.model === "string" ? obj.model : undefined,
    baseUrl: typeof obj.baseUrl === "string" ? obj.baseUrl : undefined,
    systemPrompt: typeof obj.systemPrompt === "string" ? obj.systemPrompt : undefined,
    temperature: typeof obj.temperature === "number" ? obj.temperature : undefined,
    maxTokens: typeof obj.maxTokens === "number" ? obj.maxTokens : undefined,
    apiKey: typeof obj.apiKey === "string" ? obj.apiKey : undefined,
    env,
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

function resolveApiKey(config: GeminiAdapterConfig): string | null {
  const configApiKey = readNonEmptyString(config.apiKey);
  if (configApiKey) return configApiKey;

  const envConfig = config.env;
  if (typeof envConfig === "object" && envConfig !== null && !Array.isArray(envConfig)) {
    const rec = envConfig as Record<string, unknown>;
    const fromEnvBinding = readNonEmptyString(rec.GEMINI_API_KEY)
      ?? readNonEmptyString(rec.GOOGLE_API_KEY);
    if (fromEnvBinding) return fromEnvBinding;
  }

  return readNonEmptyString(process.env.GEMINI_API_KEY)
    ?? readNonEmptyString(process.env.GOOGLE_API_KEY);
}

function resolveBaseUrl(config: GeminiAdapterConfig): string {
  return (config.baseUrl ?? process.env.GEMINI_BASE_URL ?? DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, "");
}

// The OpenAI-compat endpoint expects a bare model id (no "models/" prefix).
// Strip it defensively in case the picker stored the prefixed form.
function normalizeModelId(model: string): string {
  return model.startsWith("models/") ? model.slice("models/".length) : model;
}

function buildHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
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

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const config = readConfig(ctx.agent.adapterConfig);
  const model = normalizeModelId(requireGeminiModelId(config.model));
  if (!isFreeTierGeminiModel(model)) {
    // Defensive guard. The picker filters this list, but a stored config
    // could pre-date the filter or someone could hand-edit adapterConfig.
    // Refusing here keeps the "free-only" promise at runtime, not just UI.
    return failResult(
      "gemini_non_free_model",
      `Gemini adapter is configured for free-tier models only; "${model}" is not in the free tier. Pick a flash variant.`,
    );
  }

  const apiKey = resolveApiKey(config);
  if (!apiKey) {
    return failResult(
      "gemini_api_key_missing",
      "Gemini API key is missing. Set GEMINI_API_KEY (or GOOGLE_API_KEY) on the agent or host environment.",
    );
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
    res = await fetch(`${baseUrl}/openai/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.onLog("stderr", `Gemini request failed: ${message}\n`);
    return failResult("gemini_transport_error", message);
  }

  const latencyMs = Date.now() - startedAt;
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    await ctx.onLog("stderr", `non-JSON response from Gemini (HTTP ${res.status})\n${text.slice(0, 1000)}\n`);
    return failResult("gemini_non_json", `Gemini returned non-JSON, HTTP ${res.status}`);
  }

  if (!res.ok) {
    const errBody = parsed as { error?: { message?: string; type?: string; status?: string } };
    const msg = errBody?.error?.message ?? `HTTP ${res.status}`;
    await ctx.onLog("stderr", `Gemini ${res.status}: ${msg}\n`);
    return failResult(
      errBody?.error?.type ?? errBody?.error?.status ?? `gemini_http_${res.status}`,
      msg,
    );
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
    provider: "google",
    biller: "google",
    model,
    // Gemini's free tier means the call has $0 cost up to the daily quota
    // (the cost meter records 0 because no per-token pricing is registered
    // for Google free models). When the operator goes over quota the API
    // returns 429s rather than silently billing — the adapter surfaces
    // those as gemini_http_429 errors, not silent overage.
    billingType: "api",
    summary: assistantText.slice(0, 200) || null,
    resultJson: {
      latencyMs,
      finishReason: completion.choices?.[0]?.finish_reason ?? null,
    },
  };
}

export async function testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
  return testGeminiEnvironment({
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
