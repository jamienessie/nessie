import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { blackBoxRecords } from "@nessie/db";

// Black Box recorder. Append-only forensic log keyed by (scope, scope_id).
// Callers — heartbeat runs, meetings, hires, incident war rooms — call
// record() at lifecycle moments. The Cockpit drill-down reads
// listByScope(scopeId) to render the trace timeline.

export type BlackBoxScope = "run" | "meeting" | "hire" | "incident" | "decision";

export class BlackBoxRecorder {
  constructor(private readonly db: Db) {}

  async record(input: {
    scope: BlackBoxScope;
    scopeId: string;
    label?: string | null;
    snapshot: Record<string, unknown>;
  }) {
    const [created] = await this.db
      .insert(blackBoxRecords)
      .values({
        scope: input.scope,
        scopeId: input.scopeId,
        label: input.label ?? null,
        snapshot: input.snapshot,
      })
      .returning();
    return created;
  }

  async listByScope(scope: BlackBoxScope, scopeId: string, limit = 200) {
    return this.db
      .select()
      .from(blackBoxRecords)
      .where(and(eq(blackBoxRecords.scope, scope), eq(blackBoxRecords.scopeId, scopeId)))
      .orderBy(desc(blackBoxRecords.recordedAt))
      .limit(limit);
  }
}

export function blackBoxRecorder(db: Db) {
  return new BlackBoxRecorder(db);
}
