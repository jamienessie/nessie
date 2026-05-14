import { describe, expect, it, vi } from "vitest";
import { ReputationService } from "./reputation.js";
import type { Db } from "@nessie/db";

function makeStubDb(eventDeltas: number[]): {
  db: Db;
  lastAgentScore: () => number | null;
  insertedEvents: () => Array<Record<string, unknown>>;
} {
  const inserted: Array<Record<string, unknown>> = [];
  let lastScore: number | null = null;
  const stub = {
    insert: vi.fn(() => ({
      values: (vals: Record<string, unknown>) => {
        inserted.push(vals);
        return {
          returning: async () => [{ id: `evt-${inserted.length}`, ...vals }],
        };
      },
    })),
    select: vi.fn(() => ({
      from: () => ({
        where: () => {
          const total = eventDeltas.reduce((acc, d) => acc + d, 0);
          return Promise.resolve([{ total: String(total) }]);
        },
      }),
    })),
    update: vi.fn(() => ({
      set: (vals: Record<string, unknown>) => {
        lastScore = typeof vals.reputationScore === "number" ? vals.reputationScore : null;
        return { where: async () => undefined };
      },
    })),
  } as unknown as Db;
  return {
    db: stub,
    lastAgentScore: () => lastScore,
    insertedEvents: () => inserted,
  };
}

describe("ReputationService.recompute", () => {
  it("returns baseline 50 when no events", async () => {
    const { db, lastAgentScore } = makeStubDb([]);
    const svc = new ReputationService(db);
    const score = await svc.recompute("a-1");
    expect(score).toBe(50);
    expect(lastAgentScore()).toBe(50);
  });

  it("adds positive deltas to baseline", async () => {
    const { db, lastAgentScore } = makeStubDb([1, 2, -1]);
    const svc = new ReputationService(db);
    const score = await svc.recompute("a-1");
    expect(score).toBe(52);
    expect(lastAgentScore()).toBe(52);
  });

  it("clamps below 0", async () => {
    const { db } = makeStubDb([-100, -10]);
    const svc = new ReputationService(db);
    expect(await svc.recompute("a-1")).toBe(0);
  });

  it("clamps above 100", async () => {
    const { db } = makeStubDb([200]);
    const svc = new ReputationService(db);
    expect(await svc.recompute("a-1")).toBe(100);
  });
});

describe("ReputationService.recordEvent", () => {
  it("inserts the event then recomputes aggregate", async () => {
    const { db, insertedEvents, lastAgentScore } = makeStubDb([5]);
    const svc = new ReputationService(db);
    await svc.recordEvent({
      agentId: "a-1",
      dimension: "quality",
      delta: 5,
      reason: "shipped clean PR",
    });
    expect(insertedEvents()).toHaveLength(1);
    expect(insertedEvents()[0]).toMatchObject({
      agentId: "a-1",
      dimension: "quality",
      delta: 5,
      reason: "shipped clean PR",
    });
    expect(lastAgentScore()).toBe(55);
  });
});
