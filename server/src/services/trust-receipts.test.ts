import { describe, expect, it, vi } from "vitest";
import { TrustReceiptsService } from "./trust-receipts.js";
import type { Db } from "@nessie/db";

type Row = Record<string, unknown>;

function makeStubDb(rows: Row[] = []): { db: Db; lastInsert: () => Row | null } {
  let lastInsert: Row | null = null;
  const stub = {
    insert: vi.fn(() => ({
      values: (vals: Row) => {
        lastInsert = vals;
        return { returning: async () => [{ id: "receipt-1", ...vals }] };
      },
    })),
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve(rows),
          }),
        }),
      }),
    })),
  } as unknown as Db;
  return { db: stub, lastInsert: () => lastInsert };
}

describe("TrustReceiptsService.issue", () => {
  it("inserts the receipt with summary + body", async () => {
    const { db, lastInsert } = makeStubDb();
    const svc = new TrustReceiptsService(db);
    await svc.issue({
      scopeKind: "issue",
      scopeId: "issue-42",
      summary: "Shipped checkout flow refactor",
      body: { policiesApplied: ["pol-1"], costCents: 4200 },
      issuedByUserId: "user-1",
    });
    const row = lastInsert()!;
    expect(row.scopeKind).toBe("issue");
    expect(row.scopeId).toBe("issue-42");
    expect(row.summary).toBe("Shipped checkout flow refactor");
    expect(row.body).toEqual({ policiesApplied: ["pol-1"], costCents: 4200 });
    expect(row.issuedByUserId).toBe("user-1");
  });

  it("defaults body to empty object", async () => {
    const { db, lastInsert } = makeStubDb();
    const svc = new TrustReceiptsService(db);
    await svc.issue({ scopeKind: "hire", scopeId: "hire-1", summary: "Hired Marcus Chen" });
    expect(lastInsert()!.body).toEqual({});
  });
});

describe("TrustReceiptsService.listForScope", () => {
  it("returns rows filtered by scope (delegated to db)", async () => {
    const fake = { id: "r-1", scopeKind: "issue", scopeId: "i-1", summary: "x" };
    const { db } = makeStubDb([fake]);
    const svc = new TrustReceiptsService(db);
    const rows = await svc.listForScope("issue", "i-1");
    expect(rows).toEqual([fake]);
  });
});
