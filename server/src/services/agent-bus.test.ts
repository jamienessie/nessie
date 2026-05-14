import { describe, expect, it, vi } from "vitest";
import { AgentBusService } from "./agent-bus.js";
import type { Db } from "@nessie/db";

type InsertedRow = Record<string, unknown>;

function makeStubDb(): { db: Db; lastInsert: () => InsertedRow | null; lastUpdatePatch: () => Record<string, unknown> | null } {
  let lastInsertValues: InsertedRow | null = null;
  let lastUpdateValues: Record<string, unknown> | null = null;
  const stub = {
    insert: vi.fn(() => ({
      values: (vals: InsertedRow) => {
        lastInsertValues = vals;
        return {
          returning: async () => [{ id: "msg-1", ...vals }],
        };
      },
    })),
    update: vi.fn(() => ({
      set: (vals: Record<string, unknown>) => {
        lastUpdateValues = vals;
        return {
          where: () => ({
            returning: async () => [{ id: "msg-1", ...vals }],
          }),
        };
      },
    })),
  } as unknown as Db;
  return {
    db: stub,
    lastInsert: () => lastInsertValues,
    lastUpdatePatch: () => lastUpdateValues,
  };
}

describe("AgentBusService.send rewrap", () => {
  it("rewraps disallowed-at-level kinds into operator_approval_request", async () => {
    const { db, lastInsert } = makeStubDb();
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
    const { db, lastInsert } = makeStubDb();
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
    const { db, lastInsert } = makeStubDb();
    const svc = new AgentBusService(db);
    await svc.send({ companyId: "co-1", kind: "budget_request", payload: {}, senderAutonomyLevel: 3 });
    expect(lastInsert()!.kind).toBe("operator_approval_request");
  });

  it("does not rewrap budget_request at L4", async () => {
    const { db, lastInsert } = makeStubDb();
    const svc = new AgentBusService(db);
    await svc.send({ companyId: "co-1", kind: "budget_request", payload: { amount: 100 }, senderAutonomyLevel: 4 });
    const row = lastInsert()!;
    expect(row.kind).toBe("budget_request");
    expect(row.payload).toEqual({ amount: 100 });
  });

  it("passes kind through verbatim when senderAutonomyLevel is omitted", async () => {
    const { db, lastInsert } = makeStubDb();
    const svc = new AgentBusService(db);
    await svc.send({ companyId: "co-1", kind: "hiring_request", payload: { x: 1 } });
    const row = lastInsert()!;
    expect(row.kind).toBe("hiring_request");
    expect(row.payload).toEqual({ x: 1 });
  });

  it("inserts at status=pending with the provided ids", async () => {
    const { db, lastInsert } = makeStubDb();
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
