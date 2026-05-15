import { describe, expect, it, vi } from "vitest";
import { sendAsAgent, sendFromOperator } from "./agent-bus-helpers.js";
import type { Db } from "@nessie/db";

type Row = Record<string, unknown>;

function makeStubDb(): { db: Db; inserts: () => Row[] } {
  const allInserts: Row[] = [];
  let id = 0;
  const stub = {
    insert: vi.fn(() => ({
      values: (vals: Row) => {
        id += 1;
        allInserts.push(vals);
        return { returning: async () => [{ id: `msg-${id}`, ...vals }] };
      },
    })),
  } as unknown as Db;
  return { db: stub, inserts: () => allInserts };
}

describe("sendAsAgent", () => {
  it("stamps senderAutonomyLevel from agent context onto the bus row", async () => {
    const { db, inserts } = makeStubDb();
    await sendAsAgent(
      db,
      { id: "agent-1", companyId: "co-1", autonomyLevel: 3 },
      { kind: "clarification_request", toAgentId: "agent-2", payload: { question: "?" } },
    );
    expect(inserts()).toHaveLength(1);
    const row = inserts()[0];
    expect(row.fromAgentId).toBe("agent-1");
    expect(row.companyId).toBe("co-1");
    expect(row.kind).toBe("clarification_request");
  });

  it("rewraps to operator_approval_request when agent autonomy below required", async () => {
    const { db, inserts } = makeStubDb();
    await sendAsAgent(
      db,
      { id: "agent-1", companyId: "co-1", autonomyLevel: 1 },
      { kind: "hiring_request", payload: { title: "CTO" } },
    );
    // primary + sibling policy_check
    expect(inserts()).toHaveLength(2);
    expect(inserts()[0].kind).toBe("operator_approval_request");
    expect(inserts()[1].kind).toBe("policy_check");
  });

  it("does not rewrap when agent autonomy meets requirement", async () => {
    const { db, inserts } = makeStubDb();
    await sendAsAgent(
      db,
      { id: "agent-1", companyId: "co-1", autonomyLevel: 5 },
      { kind: "review_request", toAgentId: "agent-2", payload: {} },
    );
    expect(inserts()).toHaveLength(1);
    expect(inserts()[0].kind).toBe("review_request");
  });
});

describe("sendFromOperator", () => {
  it("sends without senderAutonomyLevel so gating never fires", async () => {
    const { db, inserts } = makeStubDb();
    await sendFromOperator(db, "co-1", {
      kind: "hiring_request",
      payload: { roleTitle: "CTO" },
    });
    expect(inserts()).toHaveLength(1);
    const row = inserts()[0];
    expect(row.kind).toBe("hiring_request");
    expect(row.fromAgentId).toBeNull();
    expect(row.companyId).toBe("co-1");
  });
});
