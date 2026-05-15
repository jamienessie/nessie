// Plan §next-up. Coaching Notes service.
//
// Operator-curated persistent guidance per agent. Active notes are
// prepended to the agent's system prompt at heartbeat dispatch time so
// the agent re-receives the operator's standing guidance every run.
//
// CRUD is intentionally simple: create / list / archive. There's no
// "edit" — operators that want to change a note archive the old and
// create a new one, which preserves audit history without a separate
// versions table.

import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { agentCoachingNotes } from "@nessie/db";
import { logActivity } from "./activity-log.js";

export type CoachingNoteStatus = "active" | "archived";

export interface CoachingNote {
  id: string;
  companyId: string;
  agentId: string;
  body: string;
  status: CoachingNoteStatus;
  position: number;
  authoredByUserId: string | null;
  archivedByUserId: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function toRow(row: typeof agentCoachingNotes.$inferSelect): CoachingNote {
  return {
    id: row.id,
    companyId: row.companyId,
    agentId: row.agentId,
    body: row.body,
    status: row.status as CoachingNoteStatus,
    position: row.position,
    authoredByUserId: row.authoredByUserId,
    archivedByUserId: row.archivedByUserId,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export interface CoachingNotesService {
  list(companyId: string, agentId: string, opts?: { includeArchived?: boolean }): Promise<CoachingNote[]>;
  create(input: {
    companyId: string;
    agentId: string;
    body: string;
    position?: number;
    authoredByUserId?: string | null;
  }): Promise<CoachingNote>;
  archive(input: {
    companyId: string;
    noteId: string;
    archivedByUserId?: string | null;
  }): Promise<CoachingNote | null>;
  /** Returns the prefix string to prepend to the agent's system prompt. */
  assemblePrefix(companyId: string, agentId: string): Promise<string>;
}

export function coachingNotesService(db: Db): CoachingNotesService {
  return {
    async list(companyId, agentId, opts) {
      const conds = [eq(agentCoachingNotes.companyId, companyId), eq(agentCoachingNotes.agentId, agentId)];
      if (!opts?.includeArchived) conds.push(eq(agentCoachingNotes.status, "active"));
      const rows = await db
        .select()
        .from(agentCoachingNotes)
        .where(and(...conds))
        .orderBy(asc(agentCoachingNotes.position), asc(agentCoachingNotes.createdAt));
      return rows.map(toRow);
    },

    async create(input) {
      const trimmed = input.body.trim();
      if (!trimmed) throw new Error("note body is required");
      const [created] = await db
        .insert(agentCoachingNotes)
        .values({
          companyId: input.companyId,
          agentId: input.agentId,
          body: trimmed,
          position: input.position ?? 0,
          authoredByUserId: input.authoredByUserId ?? null,
        })
        .returning();
      await logActivity(db, {
        companyId: input.companyId,
        actorType: input.authoredByUserId ? "user" : "system",
        actorId: input.authoredByUserId ?? "nessie-coaching",
        action: "agent.coaching_note_created",
        entityType: "agent",
        entityId: input.agentId,
        details: { noteId: created.id, position: created.position },
      });
      return toRow(created);
    },

    async archive(input) {
      const existing = await db
        .select()
        .from(agentCoachingNotes)
        .where(
          and(eq(agentCoachingNotes.id, input.noteId), eq(agentCoachingNotes.companyId, input.companyId)),
        )
        .limit(1);
      if (!existing[0]) return null;
      if (existing[0].status === "archived") return toRow(existing[0]);
      const [updated] = await db
        .update(agentCoachingNotes)
        .set({
          status: "archived",
          archivedByUserId: input.archivedByUserId ?? null,
          archivedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(agentCoachingNotes.id, input.noteId))
        .returning();
      await logActivity(db, {
        companyId: input.companyId,
        actorType: input.archivedByUserId ? "user" : "system",
        actorId: input.archivedByUserId ?? "nessie-coaching",
        action: "agent.coaching_note_archived",
        entityType: "agent",
        entityId: existing[0].agentId,
        details: { noteId: updated.id },
      });
      return toRow(updated);
    },

    async assemblePrefix(companyId, agentId) {
      const rows = await db
        .select({ body: agentCoachingNotes.body })
        .from(agentCoachingNotes)
        .where(
          and(
            eq(agentCoachingNotes.companyId, companyId),
            eq(agentCoachingNotes.agentId, agentId),
            eq(agentCoachingNotes.status, "active"),
          ),
        )
        .orderBy(asc(agentCoachingNotes.position), asc(agentCoachingNotes.createdAt));
      if (rows.length === 0) return "";
      const bullets = rows.map((r) => `- ${r.body.trim()}`).join("\n");
      return [
        "## Operator coaching",
        "These notes were left by the operator and apply to every run until archived:",
        bullets,
        "",
      ].join("\n");
    },
  };
}
