// Plan §next-up. Snippets service — versioned operator-curated prompt
// snippets, mirroring the operator-constitution pattern (head row +
// transactional version snapshot per upsert).

import { and, asc, desc, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { snippetRevisions, snippets } from "@nessie/db";
import { logActivity } from "./activity-log.js";

export interface Snippet {
  id: string;
  companyId: string;
  key: string;
  title: string;
  body: string;
  version: number;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SnippetRevision {
  id: string;
  snippetId: string;
  version: number;
  body: string;
  note: string | null;
  snapshotByUserId: string | null;
  createdAt: string;
}

function toSnippet(row: typeof snippets.$inferSelect): Snippet {
  return {
    id: row.id,
    companyId: row.companyId,
    key: row.key,
    title: row.title,
    body: row.body,
    version: row.version,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toRevision(row: typeof snippetRevisions.$inferSelect): SnippetRevision {
  return {
    id: row.id,
    snippetId: row.snippetId,
    version: row.version,
    body: row.body,
    note: row.note,
    snapshotByUserId: row.snapshotByUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface SnippetsService {
  list(companyId: string): Promise<Snippet[]>;
  get(companyId: string, key: string): Promise<Snippet | null>;
  upsert(input: {
    companyId: string;
    key: string;
    title: string;
    body: string;
    note?: string | null;
    updatedByUserId?: string | null;
  }): Promise<Snippet>;
  listRevisions(companyId: string, key: string): Promise<SnippetRevision[]>;
  delete(companyId: string, key: string): Promise<boolean>;
}

const KEY_PATTERN = /^[a-z0-9_-]{1,64}$/;

export function snippetsService(db: Db): SnippetsService {
  return {
    async list(companyId) {
      const rows = await db
        .select()
        .from(snippets)
        .where(eq(snippets.companyId, companyId))
        .orderBy(asc(snippets.key));
      return rows.map(toSnippet);
    },

    async get(companyId, key) {
      const rows = await db
        .select()
        .from(snippets)
        .where(and(eq(snippets.companyId, companyId), eq(snippets.key, key)))
        .limit(1);
      return rows[0] ? toSnippet(rows[0]) : null;
    },

    async upsert(input) {
      if (!KEY_PATTERN.test(input.key)) {
        throw new Error("snippet key must match /^[a-z0-9_-]{1,64}$/");
      }
      const trimmedTitle = input.title.trim();
      const trimmedBody = input.body.trim();
      if (!trimmedTitle) throw new Error("title required");
      if (!trimmedBody) throw new Error("body required");

      return db.transaction(async (tx) => {
        const existing = await tx
          .select()
          .from(snippets)
          .where(and(eq(snippets.companyId, input.companyId), eq(snippets.key, input.key)))
          .limit(1);
        if (existing[0]) {
          const newVersion = existing[0].version + 1;
          const [updated] = await tx
            .update(snippets)
            .set({
              title: trimmedTitle,
              body: trimmedBody,
              version: newVersion,
              updatedByUserId: input.updatedByUserId ?? null,
              updatedAt: new Date(),
            })
            .where(eq(snippets.id, existing[0].id))
            .returning();
          await tx.insert(snippetRevisions).values({
            snippetId: existing[0].id,
            version: newVersion,
            body: trimmedBody,
            note: input.note ?? null,
            snapshotByUserId: input.updatedByUserId ?? null,
          });
          await logActivity(db, {
            companyId: input.companyId,
            actorType: input.updatedByUserId ? "user" : "system",
            actorId: input.updatedByUserId ?? "nessie-snippets",
            action: "snippet.updated",
            entityType: "snippet",
            entityId: existing[0].id,
            details: { key: input.key, version: newVersion },
          });
          return toSnippet(updated);
        }
        const [created] = await tx
          .insert(snippets)
          .values({
            companyId: input.companyId,
            key: input.key,
            title: trimmedTitle,
            body: trimmedBody,
            version: 1,
            updatedByUserId: input.updatedByUserId ?? null,
          })
          .returning();
        await tx.insert(snippetRevisions).values({
          snippetId: created.id,
          version: 1,
          body: trimmedBody,
          note: input.note ?? null,
          snapshotByUserId: input.updatedByUserId ?? null,
        });
        await logActivity(db, {
          companyId: input.companyId,
          actorType: input.updatedByUserId ? "user" : "system",
          actorId: input.updatedByUserId ?? "nessie-snippets",
          action: "snippet.created",
          entityType: "snippet",
          entityId: created.id,
          details: { key: input.key },
        });
        return toSnippet(created);
      });
    },

    async listRevisions(companyId, key) {
      const head = await db
        .select({ id: snippets.id })
        .from(snippets)
        .where(and(eq(snippets.companyId, companyId), eq(snippets.key, key)))
        .limit(1);
      if (!head[0]) return [];
      const rows = await db
        .select()
        .from(snippetRevisions)
        .where(eq(snippetRevisions.snippetId, head[0].id))
        .orderBy(desc(snippetRevisions.version));
      return rows.map(toRevision);
    },

    async delete(companyId, key) {
      const head = await db
        .select({ id: snippets.id })
        .from(snippets)
        .where(and(eq(snippets.companyId, companyId), eq(snippets.key, key)))
        .limit(1);
      if (!head[0]) return false;
      await db.delete(snippets).where(eq(snippets.id, head[0].id));
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: "operator",
        action: "snippet.deleted",
        entityType: "snippet",
        entityId: head[0].id,
        details: { key },
      });
      return true;
    },
  };
}
