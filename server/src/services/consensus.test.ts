import { describe, expect, it, vi } from "vitest";
import { runConsensus } from "./consensus.js";
import type { Db } from "@nessie/db";

vi.mock("./arena-service.js", () => ({
  arenaService: vi.fn(),
}));

import { arenaService } from "./arena-service.js";

function mockRunSync(value: unknown) {
  vi.mocked(arenaService).mockReturnValue({ runSync: vi.fn(async () => value) } as never);
}

describe("runConsensus", () => {
  it("rejects fewer than 2 models", async () => {
    const result = await runConsensus({} as Db, {
      companyId: "co",
      prompt: "p",
      models: ["t3:llama-3.1-8b"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/at least 2/);
  });

  it("returns the winner's output on a successful judged run", async () => {
    mockRunSync({
      id: "arena-1",
      status: "judged",
      winnerModel: "t3:llama-3.1-70b",
      judgeError: null,
      totalCostCents: 4,
      results: [
        {
          model: "t3:llama-3.1-70b",
          status: "completed",
          outputText: "winning answer",
          score: 90,
          costCents: 2,
          latencyMs: 800,
        },
        {
          model: "t3:llama-3.1-8b",
          status: "completed",
          outputText: "runner-up",
          score: 50,
          costCents: 2,
          latencyMs: 600,
        },
      ],
    });
    const result = await runConsensus({} as Db, {
      companyId: "co",
      prompt: "what time is it",
      models: ["t3:llama-3.1-70b", "t3:llama-3.1-8b"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.winnerModel).toBe("t3:llama-3.1-70b");
    expect(result.output).toBe("winning answer");
    expect(result.costCents).toBe(4);
    expect(result.latencyMs).toBe(800);
    expect(result.perCandidate).toHaveLength(2);
  });

  it("propagates judge failure as a consensus failure with the arena run id", async () => {
    mockRunSync({
      id: "arena-2",
      status: "failed",
      winnerModel: null,
      judgeError: "judge_parse_failed",
      totalCostCents: 1,
      results: [],
    });
    const result = await runConsensus({} as Db, {
      companyId: "co",
      prompt: "p",
      models: ["t3:a", "t3:b"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.arenaRunId).toBe("arena-2");
    expect(result.error).toBe("judge_parse_failed");
  });

  it("propagates underlying create failure (no arena run created)", async () => {
    mockRunSync({ ok: false, error: "company is paused: budget hard-stop is exceeded" });
    const result = await runConsensus({} as Db, {
      companyId: "co",
      prompt: "p",
      models: ["t3:a", "t3:b"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/budget/);
  });
});
