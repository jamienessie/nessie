// Plan §20.6 Model Arena judge.
//
// Single-call ranking judge: one LLM sees every candidate output and
// returns a structured ranking. The alternative (per-candidate
// independent scoring) is documented as a v2 follow-up — single-call is
// cheaper, faster, and good enough for the first slice. Position bias is
// mitigated by always presenting candidates in a fixed, alphabetised
// order regardless of completion timing.
//
// Calls the cost-tier proxy directly (mirrors server/src/services/llm-call.ts)
// so the judge's own spend lands in cost_events. Retries up to MAX_PARSE_RETRIES
// times on parse / schema failure with a clarifying followup, then returns a
// structured error.

import { extractJsonObject } from "./llm-json-parse.js";

const PROXY_BASE = process.env.PAPERCLIP_PROXY_URL?.trim() || "http://127.0.0.1:7777";
const MAX_PARSE_RETRIES = 3;
const JUDGE_TIMEOUT_MS = 60_000;

export interface JudgeCandidate {
  model: string;
  outputText: string;
}

export interface JudgeRanking {
  model: string;
  score: number;
  reasoning: string;
}

export interface JudgeSuccess {
  ok: true;
  rankings: JudgeRanking[];
  winnerModel: string;
  notes: string;
  rubric: Record<string, unknown>;
  judgeCostCents: number;
  rawResponse: string;
}

export interface JudgeFailure {
  ok: false;
  error: string;
  lastRawResponse: string | null;
  judgeCostCents: number;
}

export interface ScoreCandidatesInput {
  companyId: string;
  judgeModel: string;
  taskType: string;
  prompt: string;
  candidates: JudgeCandidate[];
  /** Override the default fetch (tests). */
  fetchImpl?: typeof fetch;
}

function tierForModel(modelAlias: string): "T1" | "T2" | "T3" {
  if (modelAlias.startsWith("t1:")) return "T1";
  if (modelAlias.startsWith("t3:")) return "T3";
  return "T2";
}

function buildPrompt(input: { taskType: string; prompt: string; sorted: JudgeCandidate[] }): string {
  const blocks = input.sorted.map((c, i) => {
    return [
      `### Candidate ${i + 1}`,
      `model: ${c.model}`,
      "",
      c.outputText || "(empty response)",
    ].join("\n");
  }).join("\n\n");

  return [
    `You are an impartial judge ranking outputs from multiple AI models on a "${input.taskType}" task.`,
    "",
    "**Task prompt:**",
    input.prompt,
    "",
    "**Candidate outputs (presented in alphabetical order by model):**",
    "",
    blocks,
    "",
    "Score each candidate 0-100 on:",
    "- correctness / factual accuracy",
    "- helpfulness / completeness for the task",
    "- clarity and structure",
    "",
    "Return STRICT JSON matching this schema, no prose, no fences:",
    `{
  "rubric": { "correctness": "<weight 0-1>", "helpfulness": "<weight 0-1>", "clarity": "<weight 0-1>" },
  "rankings": [
    { "model": "<candidate model alias>", "score": <0-100>, "reasoning": "<1-2 sentences>" }
  ],
  "winner": "<the single best model alias>",
  "notes": "<1-2 sentences explaining the verdict>"
}`,
    "",
    `Your response MUST include every candidate model exactly once in "rankings". The "winner" MUST be one of the listed candidate models.`,
  ].join("\n");
}

function buildFollowup(lastError: string): string {
  return [
    `Your last response could not be parsed: ${lastError}.`,
    "",
    `Respond again with STRICT JSON only, matching the schema exactly. No prose, no fences.`,
  ].join("\n");
}

interface ProxyOpenAiResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

interface CallProxyResult {
  ok: true;
  text: string;
  costCents: number;
}
interface CallProxyError {
  ok: false;
  error: string;
}

async function callJudgeProxy(input: {
  companyId: string;
  judgeModel: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  fetchImpl: typeof fetch;
}): Promise<CallProxyResult | CallProxyError> {
  let res: Response;
  try {
    res = await input.fetchImpl(`${PROXY_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nessie-tier": tierForModel(input.judgeModel),
        "x-nessie-company": input.companyId,
        "x-nessie-agent": "nessie-arena-judge",
        "x-nessie-operator-triggered": "true",
      },
      body: JSON.stringify({
        model: input.judgeModel,
        messages: input.messages,
        stream: false,
        response_format: { type: "json_object" },
        temperature: 0,
      }),
      signal: AbortSignal.timeout(JUDGE_TIMEOUT_MS),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "proxy unreachable" };
  }

  const raw = await res.text();
  if (!res.ok) return { ok: false, error: `judge upstream ${res.status}: ${raw.slice(0, 200)}` };

  let parsed: ProxyOpenAiResponse;
  try {
    parsed = JSON.parse(raw) as ProxyOpenAiResponse;
  } catch {
    return { ok: false, error: `judge upstream returned non-JSON (${res.status})` };
  }

  const text = parsed.choices?.[0]?.message?.content ?? "";
  // The proxy's cost-meter writes the cost_events row server-side. We use
  // the usage block to compute a best-effort costCents to denormalize
  // into arena_runs.totalCostCents. Worst case we under-count by a few
  // cents — the source of truth remains cost_events.
  const totalTokens = (parsed.usage?.prompt_tokens ?? 0) + (parsed.usage?.completion_tokens ?? 0);
  const costCents = Math.ceil(totalTokens / 1000) * 1;
  return { ok: true, text, costCents };
}

function validateJudgeBody(input: {
  body: Record<string, unknown>;
  candidateModels: string[];
}): { ok: true; rankings: JudgeRanking[]; winner: string; notes: string; rubric: Record<string, unknown> } | { ok: false; error: string } {
  const rawRankings = input.body.rankings;
  if (!Array.isArray(rawRankings)) return { ok: false, error: "missing rankings array" };
  if (rawRankings.length !== input.candidateModels.length) {
    return { ok: false, error: `expected ${input.candidateModels.length} rankings, got ${rawRankings.length}` };
  }
  const rankings: JudgeRanking[] = [];
  const seen = new Set<string>();
  for (const r of rawRankings) {
    if (typeof r !== "object" || r === null) return { ok: false, error: "ranking entry not an object" };
    const row = r as Record<string, unknown>;
    const model = typeof row.model === "string" ? row.model : "";
    const score = typeof row.score === "number" ? row.score : -1;
    const reasoning = typeof row.reasoning === "string" ? row.reasoning : "";
    if (!input.candidateModels.includes(model)) {
      return { ok: false, error: `unknown candidate model in rankings: ${model}` };
    }
    if (seen.has(model)) return { ok: false, error: `duplicate ranking for ${model}` };
    if (score < 0 || score > 100) return { ok: false, error: `score for ${model} out of range: ${score}` };
    seen.add(model);
    rankings.push({ model, score: Math.round(score), reasoning });
  }
  const winner = typeof input.body.winner === "string" ? input.body.winner : "";
  if (!input.candidateModels.includes(winner)) {
    return { ok: false, error: `winner "${winner}" is not one of the candidates` };
  }
  const notes = typeof input.body.notes === "string" ? input.body.notes : "";
  const rubric = (input.body.rubric && typeof input.body.rubric === "object" && !Array.isArray(input.body.rubric))
    ? (input.body.rubric as Record<string, unknown>)
    : {};
  return { ok: true, rankings, winner, notes, rubric };
}

export async function scoreCandidates(input: ScoreCandidatesInput): Promise<JudgeSuccess | JudgeFailure> {
  const fetchImpl = input.fetchImpl ?? fetch;
  if (input.candidates.length === 0) {
    return { ok: false, error: "no candidates to judge", lastRawResponse: null, judgeCostCents: 0 };
  }

  const sorted = [...input.candidates].sort((a, b) => a.model.localeCompare(b.model));
  const candidateModels = sorted.map((c) => c.model);
  const systemMessage = "You are a calibrated impartial judge. Respond with strict JSON only.";
  const userMessage = buildPrompt({ taskType: input.taskType, prompt: input.prompt, sorted });

  const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage },
  ];

  let totalJudgeCostCents = 0;
  let lastRaw: string | null = null;
  let lastError = "";

  for (let attempt = 0; attempt < MAX_PARSE_RETRIES; attempt += 1) {
    const call = await callJudgeProxy({
      companyId: input.companyId,
      judgeModel: input.judgeModel,
      messages,
      fetchImpl,
    });
    if (!call.ok) {
      return { ok: false, error: call.error, lastRawResponse: lastRaw, judgeCostCents: totalJudgeCostCents };
    }
    totalJudgeCostCents += call.costCents;
    lastRaw = call.text;

    const body = extractJsonObject(call.text);
    if (!body) {
      lastError = "response was not valid JSON";
      messages.push({ role: "assistant", content: call.text });
      messages.push({ role: "user", content: buildFollowup(lastError) });
      continue;
    }

    const validated = validateJudgeBody({ body, candidateModels });
    if (!validated.ok) {
      lastError = validated.error;
      messages.push({ role: "assistant", content: call.text });
      messages.push({ role: "user", content: buildFollowup(lastError) });
      continue;
    }

    return {
      ok: true,
      rankings: validated.rankings,
      winnerModel: validated.winner,
      notes: validated.notes,
      rubric: validated.rubric,
      judgeCostCents: totalJudgeCostCents,
      rawResponse: call.text,
    };
  }

  return {
    ok: false,
    error: `judge failed after ${MAX_PARSE_RETRIES} attempts: ${lastError}`,
    lastRawResponse: lastRaw,
    judgeCostCents: totalJudgeCostCents,
  };
}
