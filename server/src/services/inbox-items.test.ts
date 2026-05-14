import { describe, expect, it, vi } from "vitest";
import { InboxItemsService } from "./inbox-items.js";
import type { Db } from "@nessie/db";

type Row = Record<string, unknown>;

function makeStubDb(): { db: Db; lastInsert: () => Row | null; lastUpdatePatch: () => Row | null } {
  let lastInsert: Row | null = null;
  let lastUpdate: Row | null = null;
  const stub = {
    insert: vi.fn(() => ({
      values: (vals: Row) => {
        lastInsert = vals;
        return { returning: async () => [{ id: "item-1", ...vals }] };
      },
    })),
    update: vi.fn(() => ({
      set: (vals: Row) => {
        lastUpdate = vals;
        return {
          where: () => ({
            returning: async () => [{ id: "item-1", ...vals }],
          }),
        };
      },
    })),
  } as unknown as Db;
  return { db: stub, lastInsert: () => lastInsert, lastUpdatePatch: () => lastUpdate };
}

describe("InboxItemsService.create", () => {
  it("defaults kind to 'note' and status to 'captured'", async () => {
    const { db, lastInsert } = makeStubDb();
    const svc = new InboxItemsService(db);
    await svc.create({ companyId: "co-1" });
    const row = lastInsert()!;
    expect(row.kind).toBe("note");
    expect(row.status).toBe("captured");
    expect(row.bodyMarkdown).toBeNull();
  });

  it("forwards custom kind, body, and refs", async () => {
    const { db, lastInsert } = makeStubDb();
    const svc = new InboxItemsService(db);
    await svc.create({
      companyId: "co-1",
      kind: "url",
      bodyMarkdown: "https://example.com",
      refs: [{ kind: "url", value: "https://example.com" }],
      capturedByUserId: "user-1",
    });
    const row = lastInsert()!;
    expect(row.kind).toBe("url");
    expect(row.bodyMarkdown).toBe("https://example.com");
    expect(row.capturedByUserId).toBe("user-1");
    expect(Array.isArray(row.refs)).toBe(true);
  });
});

describe("InboxItemsService.triage", () => {
  it("stamps triagedAt + new status + promoted refs", async () => {
    const { db, lastUpdatePatch } = makeStubDb();
    const svc = new InboxItemsService(db);
    await svc.triage("item-1", {
      status: "became_issue",
      promotedKind: "issue",
      promotedId: "issue-42",
      notes: "promoted from morning capture",
    });
    const patch = lastUpdatePatch()!;
    expect(patch.status).toBe("became_issue");
    expect(patch.promotedKind).toBe("issue");
    expect(patch.promotedId).toBe("issue-42");
    expect(patch.triagedAt).toBeInstanceOf(Date);
    expect(patch.triagedNotes).toBe("promoted from morning capture");
  });

  it("nullifies promoted refs when triage doesn't promote", async () => {
    const { db, lastUpdatePatch } = makeStubDb();
    const svc = new InboxItemsService(db);
    await svc.triage("item-1", { status: "dismissed" });
    const patch = lastUpdatePatch()!;
    expect(patch.status).toBe("dismissed");
    expect(patch.promotedKind).toBeNull();
    expect(patch.promotedId).toBeNull();
  });
});
