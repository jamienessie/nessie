import { describe, expect, it, vi } from "vitest";
import { resolveAutoRoutedModel } from "./auto-router.js";
import type { Db } from "@nessie/db";

vi.mock("./arena-service.js", () => ({
  arenaService: vi.fn(),
}));

import { arenaService } from "./arena-service.js";

type Entry = { model: string; wins: number; runsScored?: number; avgScore?: number; totalCostCents?: number };

/**
 * Mock the leaderboard fn to return different entries per (taskType?) probe.
 * The auto-router probes in this order:
 *   1. taskType === agent.role        (e.g. "engineer")
 *   2. taskType === "general"         (fallback bucket)
 *   3. no taskType filter             (company-wide)
 * `probes` is keyed by the literal taskType string ("" means no filter).
 */
function mockLeaderboardProbes(probes: Record<string, Entry[]>) {
  const lb = vi.fn(async (_companyId: string, opts?: { taskType?: string }) => {
    const key = opts?.taskType ?? "";
    return (probes[key] ?? []).map((e) => ({
      model: e.model,
      wins: e.wins,
      runsScored: e.runsScored ?? 0,
      avgScore: e.avgScore ?? 0,
      totalCostCents: e.totalCostCents ?? 0,
    }));
  });
  vi.mocked(arenaService).mockReturnValue({ leaderboard: lb } as never);
  return lb;
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
    mockLeaderboardProbes({ engineer: [{ model: "t3:llama-3.1-70b", wins: 5 }] });
    const result = await resolveAutoRoutedModel({} as Db, {
      ...baseAgent,
      runtimeConfig: {},
    });
    expect(result.source).toBe("configured");
    expect(result.reason).toBe("auto_router_disabled");
  });

  it("keeps the configured model when no probe finds an eligible winner", async () => {
    mockLeaderboardProbes({});
    const result = await resolveAutoRoutedModel({} as Db, baseAgent);
    expect(result.source).toBe("configured");
    expect(result.reason).toBe("no_leaderboard_match");
  });

  it("skips a winner that's below MIN_WINS and falls through to the next probe", async () => {
    const lb = mockLeaderboardProbes({
      engineer: [{ model: "t3:llama-3.1-70b", wins: 1 }],
      general: [{ model: "t3:mixtral-8x7b", wins: 4 }],
    });
    const result = await resolveAutoRoutedModel({} as Db, baseAgent);
    expect(result.source).toBe("leaderboard");
    expect(result.model).toBe("t3:mixtral-8x7b");
    expect(result.reason).toContain("general");
    // Both probes consulted
    expect(lb).toHaveBeenCalledTimes(2);
  });

  it("falls through to company-wide when role and general probes are empty", async () => {
    mockLeaderboardProbes({
      "": [{ model: "t3:llama-3.1-70b", wins: 3 }],
    });
    const result = await resolveAutoRoutedModel({} as Db, baseAgent);
    expect(result.source).toBe("leaderboard");
    expect(result.model).toBe("t3:llama-3.1-70b");
    expect(result.reason).toContain("company_wide");
  });

  it("ignores winners from a different tier across every probe", async () => {
    mockLeaderboardProbes({
      engineer: [{ model: "t2:gpt-4o-mini", wins: 9 }],
      general: [{ model: "t2:gpt-4o", wins: 7 }],
      "": [{ model: "t2:claude-3-5-sonnet", wins: 5 }],
    });
    const result = await resolveAutoRoutedModel({} as Db, baseAgent);
    expect(result.source).toBe("configured");
    expect(result.reason).toBe("no_leaderboard_match");
  });

  it("returns the role-tagged winner when all checks pass", async () => {
    mockLeaderboardProbes({
      engineer: [{ model: "t3:llama-3.1-70b", wins: 7 }],
    });
    const result = await resolveAutoRoutedModel({} as Db, baseAgent);
    expect(result.source).toBe("leaderboard");
    expect(result.model).toBe("t3:llama-3.1-70b");
    expect(result.reason).toContain("engineer");
  });
});
