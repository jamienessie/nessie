import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterExecutionContext,
  AdapterExecutionResult,
  AdapterSessionCodec,
} from "@nessie/adapter-utils";

// Server-side execution module for the openai-compatible adapter.
//
// Wire shape:
//   - one POST per execute() with stream: true; tokens are forwarded to
//     ctx.onLog("stdout", delta) as they arrive
//   - body is a 1-2 message OpenAI Chat Completions payload built from
//     systemPrompt + the heartbeat prompt context
//   - final usage block (via stream_options.include_usage) lifts to
//     AdapterExecutionResult.usage
//   - costUsd / billingType returned so cost_events can attribute spend
//
// Tool-call round-trips and reviewer-pattern wakeup integrate with
// heartbeat in a later phase.

const DEFAULT_PROXY_URL = "http://127.0.0.1:7777/v1";

interface OpenAiAdapterConfig {
  model?: string;
  tier?: "T1" | "T2" | "T3";
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  proxyUrl?: string;
  operatorTriggered?: boolean;
  // Plan §next-up Output Self-Critic. When true, after the primary call
  // the adapter does a second cheap call asking the same model to grade
  // its own output against a 4-line rubric. On a fail verdict the
  // adapter does one retry with the critique appended. Bounded to one
  // retry so the worst case is 3 cheap calls instead of 1.
  selfCritic?: boolean;
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
    selfCritic: typeof obj.selfCritic === "boolean" ? obj.selfCritic : undefined,
  };
}

// Output Self-Critic helper. Calls the same model with a structured
// rubric prompt and parses a JSON verdict. Returns null if the model's
// reply is unparseable — the caller treats null as "no verdict, keep
// the primary output".
async function critiqueOutput(input: {
  proxyBase: string;
  headers: Record<string, string>;
  model: string;
  taskPrompt: string;
  candidateOutput: string;
  temperature: number | undefined;
}): Promise<{ pass: boolean; reasoning: string } | null> {
  const messages = [
    {
      role: "system" as const,
      content: "You are an impartial grader. Respond with strict JSON only.",
    },
    {
      role: "user" as const,
      content: [
        "Grade the following candidate output against this 4-line rubric:",
        "1. Did it answer the task as asked?",
        "2. Did it stay in scope?",
        "3. Did it cite or ground its claims when applicable?",
        "4. Did it avoid hallucination / fabrication?",
        "",
        "**Task:**",
        input.taskPrompt,
        "",
        "**Candidate output:**",
        input.candidateOutput || "(empty)",
        "",
        `Reply with JSON: {"pass": <true|false>, "reasoning": "<one short sentence>"}`,
      ].join("\n"),
    },
  ];
  let res: Response;
  try {
    res = await fetch(`${input.proxyBase}/chat/completions`, {
      method: "POST",
      headers: input.headers,
      body: JSON.stringify({
        model: input.model,
        messages,
        temperature: input.temperature ?? 0,
        stream: false,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;
  let parsed: { choices?: Array<{ message?: { content?: string } }> };
  try {
    parsed = JSON.parse(await res.text());
  } catch {
    return null;
  }
  const text = parsed.choices?.[0]?.message?.content?.trim() ?? "";
  if (!text) return null;
  let verdict: { pass?: unknown; reasoning?: unknown };
  try {
    verdict = JSON.parse(text);
  } catch {
    // Try to find a {} block.
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      verdict = JSON.parse(text.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  if (typeof verdict.pass !== "boolean") return null;
  return {
    pass: verdict.pass,
    reasoning: typeof verdict.reasoning === "string" ? verdict.reasoning : "",
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
    stream: true,
    stream_options: { include_usage: true },
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

  if (!res.ok) {
    const text = await res.text();
    let errBody: { error?: { message?: string; type?: string } } | undefined;
    try { errBody = JSON.parse(text) as typeof errBody; } catch { /* non-JSON */ }
    const msg = errBody?.error?.message ?? (text.slice(0, 1000) || `HTTP ${res.status}`);
    await ctx.onLog("stderr", `proxy ${res.status}: ${msg}\n`);
    return failResult(errBody?.error?.type ?? `http_${res.status}`, msg);
  }

  if (!res.body) {
    return failResult("no_body", "proxy returned 200 with no body");
  }

  let completionId: string | null = null;
  let assistantText = "";
  let finishReason: string | null = null;
  let usage: { prompt_tokens?: number; completion_tokens?: number; cached_input_tokens?: number } = {};

  const decoder = new TextDecoder();
  let buffer = "";
  let streamDone = false;
  try {
    const reader = res.body.getReader();
    while (!streamDone) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        for (const line of event.split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (data === "[DONE]") {
            streamDone = true;
            break;
          }
          let chunk: {
            id?: string;
            choices?: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
            usage?: typeof usage;
          };
          try { chunk = JSON.parse(data); } catch { continue; }
          if (typeof chunk.id === "string" && !completionId) completionId = chunk.id;
          const delta = chunk.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length > 0) {
            assistantText += delta;
            await ctx.onLog("stdout", delta);
          }
          const fr = chunk.choices?.[0]?.finish_reason;
          if (typeof fr === "string") finishReason = fr;
          if (chunk.usage) usage = chunk.usage;
        }
        if (streamDone) break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await ctx.onLog("stderr", `proxy stream read failed: ${message}\n`);
    return failResult("stream_error", message);
  }

  if (assistantText && !assistantText.endsWith("\n")) {
    await ctx.onLog("stdout", "\n");
  }

  // Output Self-Critic: optional second pass that asks the same model
  // to grade the candidate output. On a fail verdict we do one
  // non-streamed retry with the critique appended. Total worst-case is
  // 3 cheap calls (primary + critique + retry).
  let criticVerdict: { pass: boolean; reasoning: string } | null = null;
  let retryUsage: typeof usage | null = null;
  if (config.selfCritic && assistantText.trim()) {
    const taskPrompt = readPromptFromContext(ctx.context);
    criticVerdict = await critiqueOutput({
      proxyBase,
      headers,
      model,
      taskPrompt,
      candidateOutput: assistantText,
      temperature: config.temperature,
    });
    if (criticVerdict && !criticVerdict.pass) {
      const retryMessages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [];
      if (config.systemPrompt) retryMessages.push({ role: "system", content: config.systemPrompt });
      retryMessages.push({ role: "user", content: taskPrompt });
      retryMessages.push({ role: "assistant", content: assistantText });
      retryMessages.push({
        role: "user",
        content: [
          "Your previous reply did not pass the rubric grader.",
          `Reason: ${criticVerdict.reasoning || "(no reasoning provided)"}.`,
          "Please revise your previous answer to address that feedback. Reply with the corrected answer only.",
        ].join("\n"),
      });
      try {
        const retryRes = await fetch(`${proxyBase}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model,
            messages: retryMessages,
            temperature: config.temperature ?? 0.2,
            max_tokens: config.maxTokens,
            stream: false,
          }),
          signal: AbortSignal.timeout(60_000),
        });
        if (retryRes.ok) {
          const retryBody = JSON.parse(await retryRes.text()) as {
            choices?: Array<{ message?: { content?: string } }>;
            usage?: typeof usage;
          };
          const retryText = retryBody.choices?.[0]?.message?.content ?? "";
          if (retryText) {
            await ctx.onLog("stdout", `\n[self-critic retry]\n${retryText}\n`);
            assistantText = retryText;
            retryUsage = retryBody.usage ?? null;
          }
        }
      } catch (err) {
        await ctx.onLog("stderr", `self-critic retry failed: ${err instanceof Error ? err.message : String(err)}\n`);
      }
    }
  }

  const latencyMs = Date.now() - startedAt;
  const totalInput = (usage.prompt_tokens ?? 0) + (retryUsage?.prompt_tokens ?? 0);
  const totalOutput = (usage.completion_tokens ?? 0) + (retryUsage?.completion_tokens ?? 0);
  const totalCached = (usage.cached_input_tokens ?? 0) + (retryUsage?.cached_input_tokens ?? 0);
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    usage: {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cachedInputTokens: totalCached,
    },
    sessionId: completionId,
    sessionParams: completionId ? { sessionId: completionId } : null,
    sessionDisplayId: completionId,
    provider: "nessie_proxy",
    biller: "nessie_proxy",
    model,
    billingType: "metered_api",
    summary: assistantText.slice(0, 200) || null,
    resultJson: {
      latencyMs,
      finishReason,
      ...(criticVerdict ? { selfCritic: criticVerdict } : {}),
    },
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
