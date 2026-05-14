import { describe, expect, it, vi } from "vitest";
import { scoreCandidates } from "./arena-judge.js";

function makeFetchReturning(responses: string[]): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const text = responses[Math.min(i, responses.length - 1)];
    i += 1;
    return new Response(text, { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
}

function openAiTextReply(text: string): string {
  return JSON.stringify({
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 },
  });
}

function judgeReply(body: Record<string, unknown>): string {
  return openAiTextReply(JSON.stringify(body));
}

const CANDIDATES = [
  { model: "t2:gpt-4o-mini", outputText: "alpha" },
  { model: "t3:llama-3.1-70b", outputText: "beta" },
];

describe("scoreCandidates", () => {
  it("returns the parsed ranking on a clean reply", async () => {
    const fetchImpl = makeFetchReturning([
      judgeReply({
        rubric: { correctness: 0.5, helpfulness: 0.5 },
        rankings: [
          { model: "t2:gpt-4o-mini", score: 80, reasoning: "tight summary" },
          { model: "t3:llama-3.1-70b", score: 55, reasoning: "verbose" },
        ],
        winner: "t2:gpt-4o-mini",
        notes: "winner is concise",
      }),
    ]);
    const result = await scoreCandidates({
      companyId: "co",
      judgeModel: "t2:gpt-4o",
      taskType: "summarize",
      prompt: "summarize",
      candidates: CANDIDATES,
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.winnerModel).toBe("t2:gpt-4o-mini");
    expect(result.rankings).toHaveLength(2);
    expect(result.rankings.find((r) => r.model === "t2:gpt-4o-mini")?.score).toBe(80);
  });

  it("retries on schema violation (missing candidate)", async () => {
    const fetchImpl = makeFetchReturning([
      judgeReply({
        rankings: [{ model: "t2:gpt-4o-mini", score: 80, reasoning: "x" }],
        winner: "t2:gpt-4o-mini",
        notes: "",
      }),
      judgeReply({
        rankings: [
          { model: "t2:gpt-4o-mini", score: 80, reasoning: "x" },
          { model: "t3:llama-3.1-70b", score: 70, reasoning: "y" },
        ],
        winner: "t2:gpt-4o-mini",
        notes: "retry good",
      }),
    ]);
    const result = await scoreCandidates({
      companyId: "co",
      judgeModel: "t2:gpt-4o",
      taskType: "summarize",
      prompt: "p",
      candidates: CANDIDATES,
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rankings).toHaveLength(2);
  });

  it("fails after MAX_PARSE_RETRIES of malformed inner content", async () => {
    const malformedEnvelope = openAiTextReply("this is definitely not json {{{");
    const fetchImpl = makeFetchReturning([malformedEnvelope, malformedEnvelope, malformedEnvelope, malformedEnvelope]);
    const result = await scoreCandidates({
      companyId: "co",
      judgeModel: "t2:gpt-4o",
      taskType: "summarize",
      prompt: "p",
      candidates: CANDIDATES,
      fetchImpl,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/judge failed after/);
  });

  it("rejects winner not in candidates", async () => {
    const fetchImpl = makeFetchReturning([
      judgeReply({
        rankings: [
          { model: "t2:gpt-4o-mini", score: 80, reasoning: "x" },
          { model: "t3:llama-3.1-70b", score: 70, reasoning: "y" },
        ],
        winner: "t9:fake-model",
        notes: "",
      }),
      judgeReply({
        rankings: [
          { model: "t2:gpt-4o-mini", score: 80, reasoning: "x" },
          { model: "t3:llama-3.1-70b", score: 70, reasoning: "y" },
        ],
        winner: "t2:gpt-4o-mini",
        notes: "fix",
      }),
    ]);
    const result = await scoreCandidates({
      companyId: "co",
      judgeModel: "t2:gpt-4o",
      taskType: "summarize",
      prompt: "p",
      candidates: CANDIDATES,
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.winnerModel).toBe("t2:gpt-4o-mini");
  });

  it("rejects scores out of [0,100] range", async () => {
    const fetchImpl = makeFetchReturning([
      judgeReply({
        rankings: [
          { model: "t2:gpt-4o-mini", score: 250, reasoning: "x" },
          { model: "t3:llama-3.1-70b", score: 70, reasoning: "y" },
        ],
        winner: "t2:gpt-4o-mini",
        notes: "",
      }),
      judgeReply({
        rankings: [
          { model: "t2:gpt-4o-mini", score: 90, reasoning: "x" },
          { model: "t3:llama-3.1-70b", score: 70, reasoning: "y" },
        ],
        winner: "t2:gpt-4o-mini",
        notes: "fix",
      }),
    ]);
    const result = await scoreCandidates({
      companyId: "co",
      judgeModel: "t2:gpt-4o",
      taskType: "summarize",
      prompt: "p",
      candidates: CANDIDATES,
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rankings.find((r) => r.model === "t2:gpt-4o-mini")?.score).toBe(90);
  });
});
