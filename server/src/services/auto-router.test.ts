import { describe, expect, it, vi } from "vitest";
import { resolveAutoRoutedModel } from "./auto-router.js";
import type { Db } from "@nessie/db";

vi.mock("./arena-service.js", () => ({
  arenaService: vi.fn(),
}));

import { arenaService } from "./arena-service.js";

function mockLeaderboard(entries: Array<{ model: string; wins: number; runsScored?: number; avgScore?: number; totalCostCents?: number }>) {
  vi.mocked(arenaService).mockReturnValue({
    leaderboard: vi.fn(async () =>
      entries.map((e) => ({
        model: e.model,
        wins: e.wins,
        runsScored: e.runsScored ?? 0,
        avgScore: e.avgScore ?? 0,
        totalCostCents: e.totalCostCents ?? 0,
      })),
    ),
  } as never);
}

const baseAgent = {
  id: "a-1",
  companyId: "co-1",
  role: "engineer",
  runtimeConfig: { autoRouter: true },
  adapterConfig: { model: "t3:llama-3.1-8b" },
  tier: "T3",
};

describe("resolveAutoRoutedModel", () => {
  it("keeps the configured model when the agent has not opted in", async () => {
    mockLeaderboard([{ model: "t3:llama-3.1-70b", wins: 5 }]);
    const result = await resolveAutoRoutedModel({} as Db, {
      ...baseAgent,
      runtimeConfig: {},
    });
    expect(result.source).toBe("configured");
    expect(result.reason).toBe("auto_router_disabled");
  });

  it("keeps the configured model when leaderboard is empty", async () => {
    mockLeaderboard([]);
    const result = await resolveAutoRoutedModel({} as Db, baseAgent);
    expect(result.source).toBe("configured");
    expect(result.reason).toBe("no_leaderboard_data");
  });

  it("keeps the configured model when winner is below MIN_WINS", async () => {
    mockLeaderboard([{ model: "t3:llama-3.1-70b", wins: 1 }]);
    const result = await resolveAutoRoutedModel({} as Db, baseAgent);
    expect(result.source).toBe("configured");
    expect(result.reason).toContain("min_wins");
  });

  it("rejects a winner from a different tier", async () => {
    mockLeaderboard([{ model: "t2:gpt-4o-mini", wins: 5 }]);
    const result = await resolveAutoRoutedModel({} as Db, baseAgent);
    expect(result.source).toBe("configured");
    expect(result.reason).toContain("tier_mismatch");
  });

  it("returns the leaderboard winner when all checks pass", async () => {
    mockLeaderboard([{ model: "t3:llama-3.1-70b", wins: 7 }]);
    const result = await resolveAutoRoutedModel({} as Db, baseAgent);
    expect(result.source).toBe("leaderboard");
    expect(result.model).toBe("t3:llama-3.1-70b");
  });
});
