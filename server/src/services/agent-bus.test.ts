import { describe, expect, it, vi } from "vitest";
import { AgentBusService } from "./agent-bus.js";
import type { Db } from "@nessie/db";

type InsertedRow = Record<string, unknown>;

function makeStubDb(): {
  db: Db;
  inserts: () => InsertedRow[];
  primaryInsert: () => InsertedRow | null;
  siblingInsert: () => InsertedRow | null;
  lastUpdatePatch: () => Record<string, unknown> | null;
} {
  const allInserts: InsertedRow[] = [];
  let lastUpdateValues: Record<string, unknown> | null = null;
  let id = 0;
  const stub = {
    insert: vi.fn(() => ({
      values: (vals: InsertedRow) => {
        id += 1;
        allInserts.push(vals);
        return {
          returning: async () => [{ id: `msg-${id}`, ...vals }],
        };
      },
    })),
    update: vi.fn(() => ({
      set: (vals: Record<string, unknown>) => {
        lastUpdateValues = vals;
        const whereResult = {
          returning: async () => [{ id: "msg-1", ...vals }],
          then: (resolve: (v: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
        };
        return { where: () => whereResult };
      },
    })),
    // Bus auto-reply rules evaluator does select().from().where().orderBy().
    // Stub returns no rules so behavior matches existing tests.
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: async () => [],
        }),
      }),
    })),
  } as unknown as Db;
  return {
    db: stub,
    inserts: () => allInserts,
    primaryInsert: () => allInserts[0] ?? null,
    siblingInsert: () => allInserts[1] ?? null,
    lastUpdatePatch: () => lastUpdateValues,
  };
}

describe("AgentBusService.send rewrap", () => {
  it("rewraps disallowed-at-level kinds into operator_approval_request", async () => {
    const { db, primaryInsert: lastInsert } = makeStubDb();
    const svc = new AgentBusService(db);
    await svc.send({
      companyId: "co-1",
      kind: "hiring_request",
      payload: { foo: "bar" },
      senderAutonomyLevel: 0,
    });
    const row = lastInsert()!;
    expect(row.kind).toBe("operator_approval_request");
    const payload = row.payload as Record<string, unknown>;
    expect(payload.originalKind).toBe("hiring_request");
    expect(payload.originalPayload).toEqual({ foo: "bar" });
    expect(typeof payload.reason).toBe("string");
  });

  it("rewraps approval-required kinds even when level allows sending", async () => {
    const { db, primaryInsert: lastInsert } = makeStubDb();
    const svc = new AgentBusService(db);
    await svc.send({
      companyId: "co-1",
      kind: "hiring_request",
      payload: {},
      senderAutonomyLevel: 2,
    });
    const row = lastInsert()!;
    expect(row.kind).toBe("operator_approval_request");
    expect((row.payload as Record<string, unknown>).originalKind).toBe("hiring_request");
  });

  it("rewraps budget_request at L3 (below L4)", async () => {
    const { db, primaryInsert: lastInsert } = makeStubDb();
    const svc = new AgentBusService(db);
    await svc.send({ companyId: "co-1", kind: "budget_request", payload: {}, senderAutonomyLevel: 3 });
    expect(lastInsert()!.kind).toBe("operator_approval_request");
  });

  it("does not rewrap budget_request at L4", async () => {
    const { db, primaryInsert: lastInsert } = makeStubDb();
    const svc = new AgentBusService(db);
    await svc.send({ companyId: "co-1", kind: "budget_request", payload: { amount: 100 }, senderAutonomyLevel: 4 });
    const row = lastInsert()!;
    expect(row.kind).toBe("budget_request");
    expect(row.payload).toEqual({ amount: 100 });
  });

  it("passes kind through verbatim when senderAutonomyLevel is omitted", async () => {
    const { db, primaryInsert: lastInsert } = makeStubDb();
    const svc = new AgentBusService(db);
    await svc.send({ companyId: "co-1", kind: "hiring_request", payload: { x: 1 } });
    const row = lastInsert()!;
    expect(row.kind).toBe("hiring_request");
    expect(row.payload).toEqual({ x: 1 });
  });

  it("inserts at status=pending with the provided ids", async () => {
    const { db, primaryInsert: lastInsert } = makeStubDb();
    const svc = new AgentBusService(db);
    await svc.send({
      companyId: "co-1",
      fromAgentId: "a-from",
      toAgentId: "a-to",
      kind: "review_request",
      payload: {},
      senderAutonomyLevel: 5,
    });
    const row = lastInsert()!;
    expect(row.status).toBe("pending");
    expect(row.fromAgentId).toBe("a-from");
    expect(row.toAgentId).toBe("a-to");
  });

  it("emits a sibling policy_check row when rewrap fires", async () => {
    const { db, inserts, siblingInsert } = makeStubDb();
    const svc = new AgentBusService(db);
    await svc.send({
      companyId: "co-1",
      fromAgentId: "a-from",
      kind: "hiring_request",
      payload: { roleTitle: "Engineer" },
      senderAutonomyLevel: 0,
    });
    expect(inserts()).toHaveLength(2);
    const sibling = siblingInsert()!;
    expect(sibling.kind).toBe("policy_check");
    const payload = sibling.payload as Record<string, unknown>;
    expect(payload.originalKind).toBe("hiring_request");
    expect(typeof payload.reason).toBe("string");
    expect(typeof payload.wrappedMessageId).toBe("string");
    expect(sibling.toAgentId).toBeNull();
    expect(sibling.parentMessageId).toBe(payload.wrappedMessageId);
  });

  it("does not emit a sibling row when no rewrap happens", async () => {
    const { db, inserts } = makeStubDb();
    const svc = new AgentBusService(db);
    await svc.send({
      companyId: "co-1",
      kind: "review_request",
      payload: {},
      senderAutonomyLevel: 5,
    });
    expect(inserts()).toHaveLength(1);
  });
});

describe("AgentBusService.markStatus", () => {
  it("stamps deliveredAt when status=delivered", async () => {
    const { db, lastUpdatePatch } = makeStubDb();
    const svc = new AgentBusService(db);
    await svc.markStatus("msg-1", "delivered");
    const patch = lastUpdatePatch()!;
    expect(patch.status).toBe("delivered");
    expect(patch.deliveredAt).toBeInstanceOf(Date);
    expect(patch.repliedAt).toBeUndefined();
  });

  it("stamps repliedAt when status=replied", async () => {
    const { db, lastUpdatePatch } = makeStubDb();
    const svc = new AgentBusService(db);
    await svc.markStatus("msg-1", "replied");
    const patch = lastUpdatePatch()!;
    expect(patch.repliedAt).toBeInstanceOf(Date);
  });

  it("does not stamp delivered/repliedAt for dismissed", async () => {
    const { db, lastUpdatePatch } = makeStubDb();
    const svc = new AgentBusService(db);
    await svc.markStatus("msg-1", "dismissed");
    const patch = lastUpdatePatch()!;
    expect(patch.deliveredAt).toBeUndefined();
    expect(patch.repliedAt).toBeUndefined();
  });
});
