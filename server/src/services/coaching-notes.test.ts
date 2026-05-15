import { describe, expect, it, vi } from "vitest";
import { coachingNotesService } from "./coaching-notes.js";
import type { Db } from "@nessie/db";

vi.mock("./activity-log.js", () => ({
  logActivity: vi.fn(async () => {}),
  publishPluginDomainEvent: vi.fn(),
}));

function makeStubDb() {
  const inserted: Record<string, unknown>[] = [];
  let updated: Record<string, unknown> | null = null;
  let selectQueue: unknown[][] = [];
  const stub = {
    insert: vi.fn(() => ({
      values: (vals: Record<string, unknown>) => ({
        returning: async () => {
          inserted.push(vals);
          return [
            {
              id: `note-${inserted.length}`,
              status: "active",
              position: 0,
              archivedByUserId: null,
              archivedAt: null,
              authoredByUserId: null,
              createdAt: new Date(),
              updatedAt: new Date(),
              ...vals,
            },
          ];
        },
      }),
    })),
    update: vi.fn(() => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            updated = vals;
            return [
              {
                id: "note-1",
                companyId: "co",
                agentId: "agent",
                body: "x",
                position: 0,
                authoredByUserId: null,
                archivedByUserId: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                archivedAt: new Date(),
                status: "archived",
                ...vals,
              },
            ];
          },
        }),
      }),
    })),
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: async () => selectQueue.shift() ?? [],
          limit: async () => selectQueue.shift() ?? [],
        }),
      }),
    })),
  } as unknown as Db;
  return {
    db: stub,
    inserted: () => inserted,
    lastUpdate: () => updated,
    queueSelect: (rows: unknown[]) => selectQueue.push(rows),
  };
}

describe("coachingNotesService", () => {
  it("create rejects empty body", async () => {
    const { db } = makeStubDb();
    const svc = coachingNotesService(db);
    await expect(
      svc.create({ companyId: "co", agentId: "a", body: "   " }),
    ).rejects.toThrow(/required/);
  });

  it("create inserts a note and returns the row", async () => {
    const { db, inserted } = makeStubDb();
    const svc = coachingNotesService(db);
    const note = await svc.create({ companyId: "co", agentId: "a", body: "be concise" });
    expect(note.body).toBe("be concise");
    expect(inserted()).toHaveLength(1);
    expect(inserted()[0]).toMatchObject({ companyId: "co", agentId: "a", body: "be concise" });
  });

  it("assemblePrefix returns empty string when no notes exist", async () => {
    const { db, queueSelect } = makeStubDb();
    queueSelect([]);
    const svc = coachingNotesService(db);
    const prefix = await svc.assemblePrefix("co", "a");
    expect(prefix).toBe("");
  });

  it("assemblePrefix bullets every active note under a header", async () => {
    const { db, queueSelect } = makeStubDb();
    queueSelect([{ body: "be concise" }, { body: "always cite file:line" }]);
    const svc = coachingNotesService(db);
    const prefix = await svc.assemblePrefix("co", "a");
    expect(prefix).toContain("Operator coaching");
    expect(prefix).toContain("- be concise");
    expect(prefix).toContain("- always cite file:line");
  });

  it("archive returns null when note not found", async () => {
    const { db, queueSelect } = makeStubDb();
    queueSelect([]);
    const svc = coachingNotesService(db);
    const result = await svc.archive({ companyId: "co", noteId: "missing" });
    expect(result).toBeNull();
  });

  it("archive flips status and stamps archivedAt", async () => {
    const { db, queueSelect, lastUpdate } = makeStubDb();
    queueSelect([
      {
        id: "note-1",
        companyId: "co",
        agentId: "a",
        body: "x",
        status: "active",
        position: 0,
        authoredByUserId: null,
        archivedByUserId: null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);
    const svc = coachingNotesService(db);
    const result = await svc.archive({ companyId: "co", noteId: "note-1", archivedByUserId: "u" });
    expect(result?.status).toBe("archived");
    expect(lastUpdate()).toMatchObject({ status: "archived", archivedByUserId: "u" });
  });
});
