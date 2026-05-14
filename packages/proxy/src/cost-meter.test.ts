import { describe, expect, it, vi } from "vitest";
import { recordCost } from "./cost-meter.js";
import type { CredentialView } from "./types.js";
import type { Db } from "@nessie/db";

type ExecuteCall = { sql: string; params: unknown[] };

function makeStubDb(): {
  db: Db;
  executes: () => ExecuteCall[];
  updates: () => Array<Record<string, unknown>>;
} {
  const executes: ExecuteCall[] = [];
  const updates: Array<Record<string, unknown>> = [];
  const stub = {
    execute: vi.fn(async (statement: { queryChunks?: unknown[] } & { sql?: string }) => {
      executes.push({
        sql: typeof statement?.sql === "string" ? statement.sql : "",
        params: Array.isArray(statement?.queryChunks) ? statement.queryChunks : [],
      });
    }),
    update: vi.fn(() => ({
      set: (vals: Record<string, unknown>) => {
        updates.push(vals);
        return { where: async () => undefined };
      },
    })),
  } as unknown as Db;
  return { db: stub, executes: () => executes, updates: () => updates };
}

const baseCred: CredentialView = {
  id: "cred-1",
  tier: "T2",
  provider: "openai",
  displayName: "openai prod",
  secretRef: "OPENAI_API_KEY",
  status: "active",
  monthlyCapCents: null,
  monthlySpentCents: 0,
  capabilities: {},
};

describe("recordCost", () => {
  it("skips insert when agentId is missing", async () => {
    const { db, executes, updates } = makeStubDb();
    await recordCost(db, {
      credential: baseCred,
      tier: "T2",
      model: "gpt-4o-mini",
      usage: { prompt_tokens: 1000, completion_tokens: 1000 },
      agentId: null,
      companyId: "co-1",
      heartbeatRunId: null,
    });
    expect(executes()).toHaveLength(0);
    expect(updates()).toHaveLength(0);
  });

  it("skips insert when companyId is missing", async () => {
    const { db, executes } = makeStubDb();
    await recordCost(db, {
      credential: baseCred,
      tier: "T2",
      model: "gpt-4o-mini",
      usage: { prompt_tokens: 100, completion_tokens: 100 },
      agentId: "a-1",
      companyId: null,
      heartbeatRunId: null,
    });
    expect(executes()).toHaveLength(0);
  });

  it("inserts a T1 call at cost_cents=0 and skips credential spend update", async () => {
    const { db, executes, updates } = makeStubDb();
    await recordCost(db, {
      credential: { ...baseCred, tier: "T1" },
      tier: "T1",
      model: "claude-sonnet-4",
      usage: { prompt_tokens: 100, completion_tokens: 200 },
      agentId: "a-1",
      companyId: "co-1",
      heartbeatRunId: "run-1",
    });
    expect(executes()).toHaveLength(1);
    expect(updates()).toHaveLength(0);
  });

  it("updates credential monthlySpentCents on a T2 paid call", async () => {
    const { db, executes, updates } = makeStubDb();
    await recordCost(db, {
      credential: baseCred,
      tier: "T2",
      model: "gpt-4o-mini",
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
      agentId: "a-1",
      companyId: "co-1",
      heartbeatRunId: null,
    });
    expect(executes()).toHaveLength(1);
    expect(updates()).toHaveLength(1);
    expect(typeof updates()[0].monthlySpentCents).toBe("object");
  });

  it("treats openrouter :free models as zero-cost on T2", async () => {
    const { db, executes, updates } = makeStubDb();
    await recordCost(db, {
      credential: { ...baseCred, provider: "openrouter" },
      tier: "T2",
      model: "meta/llama-3.1-8b-instruct:free",
      usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000 },
      agentId: "a-1",
      companyId: "co-1",
      heartbeatRunId: null,
    });
    expect(executes()).toHaveLength(1);
    // Zero cost → no credential spend update.
    expect(updates()).toHaveLength(0);
  });

  it("handles missing usage block (treats tokens as 0)", async () => {
    const { db, executes, updates } = makeStubDb();
    await recordCost(db, {
      credential: baseCred,
      tier: "T2",
      model: "gpt-4o",
      usage: undefined,
      agentId: "a-1",
      companyId: "co-1",
      heartbeatRunId: null,
    });
    expect(executes()).toHaveLength(1);
    // 0 tokens → 0 cents → no credential update.
    expect(updates()).toHaveLength(0);
  });
});
