import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterSessionCodec,
} from "@nessie/adapter-utils";
import {
  buildAzureChatCompletionsUrl,
  buildAzureChatHeaders,
  isReasoningDeployment,
  readApiVersionFromConfigOrEnv,
  requireAzureApiKey,
  requireAzureDeploymentId,
  requireAzureEndpoint,
  testAzureOpenaiEnvironment,
} from "./models.js";

interface AzureOpenAIAdapterConfig {
  deployment?: string;
  model?: string;
  endpoint?: string;
  apiVersion?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
}

function readConfig(raw: unknown): AzureOpenAIAdapterConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const obj = raw as Record<string, unknown>;
  return {
    deployment: typeof obj.deployment === "string" ? obj.deployment : undefined,
    model: typeof obj.model === "string" ? obj.model : undefined,
    endpoint: typeof obj.endpoint === "string" ? obj.endpoint : undefined,
    apiVersion: typeof obj.apiVersion === "string" ? obj.apiVersion : undefined,
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
  let deployment: string;
  try {
    deployment = requireAzureDeploymentId(config.deployment ?? config.model);
  } catch (err) {
    return failResult("azure_openai_deployment_missing", err instanceof Error ? err.message : String(err));
  }

  let apiKey: string;
  try {
    apiKey = requireAzureApiKey(ctx.agent.adapterConfig);
  } catch (err) {
    return failResult("azure_openai_api_key_missing", err instanceof Error ? err.message : String(err));
  }

  let endpoint: string;
  try {
    endpoint = requireAzureEndpoint(ctx.agent.adapterConfig);
  } catch (err) {
    return failResult("azure_openai_endpoint_missing", err instanceof Error ? err.message : String(err));
  }

  const apiVersion = readApiVersionFromConfigOrEnv(ctx.agent.adapterConfig);
  const url = buildAzureChatCompletionsUrl({ endpoint, deployment, apiVersion });
  const headers = buildAzureChatHeaders(apiKey);

  const reasoning = isReasoningDeployment(deployment);
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (config.systemPrompt) messages.push({ role: "system", content: config.systemPrompt });
  messages.push({ role: "user", content: readPromptFromContext(ctx.context) });

  const body: Record<string, unknown> = {
    messages,
    stream: false,
  };
  // o-series reasoning models reject `temperature`; everything else accepts it.
  if (!reasoning) {
    body.temperature = config.temperature ?? 0.2;
  }
  // `max_completion_tokens` is supported on all current Azure OpenAI models
  // and required for o-series. Only send it when the user has set it.
  if (typeof config.maxTokens === "number") {
    body.max_completion_tokens = config.maxTokens;
  }

  const startedAt = Date.now();
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.onLog("stderr", `Azure OpenAI request failed: ${message}\n`);
    return failResult("azure_openai_transport_error", message);
  }

  const latencyMs = Date.now() - startedAt;
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    await ctx.onLog("stderr", `non-JSON response from Azure OpenAI (HTTP ${res.status})\n${text.slice(0, 1000)}\n`);
    return failResult("azure_openai_non_json", `Azure OpenAI returned non-JSON, HTTP ${res.status}`);
  }

  if (!res.ok) {
    const errBody = parsed as { error?: { message?: string; code?: string } };
    const msg = errBody?.error?.message ?? `HTTP ${res.status}`;
    await ctx.onLog("stderr", `Azure OpenAI ${res.status}: ${msg}\n`);
    return failResult(errBody?.error?.code ?? `azure_openai_http_${res.status}`, msg);
  }

  const completion = parsed as {
    id?: string;
    choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      cached_input_tokens?: number;
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
  const assistantText = completion.choices?.[0]?.message?.content ?? "";
  if (assistantText) {
    await ctx.onLog("stdout", assistantText + "\n");
  }

  const usage = completion.usage ?? {};
  const cachedInputTokens = usage.cached_input_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0;

  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    usage: {
      inputTokens: usage.prompt_tokens ?? 0,
      outputTokens: usage.completion_tokens ?? 0,
      cachedInputTokens,
    },
    sessionId: completion.id ?? null,
    sessionParams: completion.id ? { sessionId: completion.id } : null,
    sessionDisplayId: completion.id ?? null,
    provider: "azure_openai",
    biller: "azure_openai",
    model: deployment,
    billingType: "api",
    summary: assistantText.slice(0, 200) || null,
    resultJson: {
      latencyMs,
      finishReason: completion.choices?.[0]?.finish_reason ?? null,
    },
  };
}

export async function testEnvironment(ctx: AdapterEnvironmentTestContext): Promise<AdapterEnvironmentTestResult> {
  return testAzureOpenaiEnvironment({
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
