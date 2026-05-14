import { describe, expect, it, vi } from "vitest";
import { OperatorConstitutionService } from "./operator-constitution.js";
import type { Db } from "@nessie/db";

type Row = Record<string, unknown>;

interface StubControls {
  db: Db;
  inserts: () => Row[];
  updates: () => Row[];
  setExisting: (row: Row | null) => void;
}

function makeStubDb(): StubControls {
  let existing: Row | null = null;
  const inserts: Row[] = [];
  const updates: Row[] = [];
  let id = 0;
  const tx = {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(existing ? [existing] : []),
        }),
      }),
    })),
    insert: vi.fn(() => ({
      values: (vals: Row) => {
        id += 1;
        inserts.push(vals);
        return { returning: async () => [{ id: `cid-${id}`, version: vals.version ?? 1, ...vals }] };
      },
    })),
    update: vi.fn(() => ({
      set: (vals: Row) => {
        updates.push(vals);
        return {
          where: () => ({
            returning: async () => [{ id: existing?.id ?? "cid-existing", ...existing, ...vals }],
          }),
        };
      },
    })),
  };
  const stub = {
    transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(stub)),
    ...tx,
  };
  const db = stub as unknown as Db;
  return {
    db,
    inserts: () => inserts,
    updates: () => updates,
    setExisting: (row) => { existing = row; },
  };
}

describe("OperatorConstitutionService.upsert", () => {
  it("creates v1 + v1 snapshot when none exists", async () => {
    const ctl = makeStubDb();
    const svc = new OperatorConstitutionService(ctl.db);
    const result = await svc.upsert("co-1", { sections: { mission: "ship" }, note: "first draft" });
    expect(result.created).toBe(true);
    expect(ctl.inserts()).toHaveLength(2);
    expect(ctl.inserts()[0].version).toBe(1);
    expect(ctl.inserts()[1].version).toBe(1);
    expect(ctl.inserts()[1].note).toBe("first draft");
  });

  it("increments version + writes new snapshot when one exists", async () => {
    const ctl = makeStubDb();
    ctl.setExisting({ id: "cid-existing", companyId: "co-1", version: 7 });
    const svc = new OperatorConstitutionService(ctl.db);
    const result = await svc.upsert("co-1", {
      sections: { mission: "still ship", values: ["fast"] },
      note: "tightened values",
      updatedByUserId: "user-7",
    });
    expect(result.created).toBe(false);
    expect(ctl.updates()).toHaveLength(1);
    expect(ctl.updates()[0].version).toBe(8);
    expect(ctl.inserts()).toHaveLength(1);
    expect(ctl.inserts()[0].version).toBe(8);
    expect(ctl.inserts()[0].note).toBe("tightened values");
  });

  it("snapshot row carries the updated sections (atomicity contract)", async () => {
    const ctl = makeStubDb();
    ctl.setExisting({ id: "cid-existing", companyId: "co-1", version: 1 });
    const svc = new OperatorConstitutionService(ctl.db);
    await svc.upsert("co-1", { sections: { foo: "bar" } });
    const snapshot = ctl.inserts()[0];
    expect(snapshot.sections).toEqual({ foo: "bar" });
    expect(snapshot.constitutionId).toBe("cid-existing");
  });
});
