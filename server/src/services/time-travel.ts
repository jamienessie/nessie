// Plan §next-up. Time Travel Inspector service.
//
// Reconstructs the past Cockpit state at any timestamp by replaying
// activity_log and black_box_records snapshots forward to that point.
// No LLM cost, no model needed — pure data replay.
//
// Scope is intentionally narrow for v1:
//   - activity: all activity_log rows for the company up to and
//     including the requested timestamp, newest first, capped.
//   - snapshots: the most recent black_box_records snapshot per
//     (scope, scope_id) where recordedAt <= the timestamp.
//
// Operator-visible state only. Replaying private adapter session state
// (anything inside heartbeat_runs.resultJson) is a v2 follow-up.

import { and, desc, lte, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { activityLog, agentBusMessages, arenaRuns, blackBoxRecords } from "@nessie/db";

export interface TimeTravelActivityRow {
  id: string;
  createdAt: string;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  agentId: string | null;
  runId: string | null;
  details: unknown;
}

export interface TimeTravelSnapshotRow {
  id: string;
  scope: string;
  scopeId: string;
  label: string | null;
  snapshot: unknown;
  recordedAt: string;
}

export interface TimeTravelView {
  at: string;
  activity: TimeTravelActivityRow[];
  snapshots: TimeTravelSnapshotRow[];
  state: {
    /** Arena runs that were in 'running' status at the chosen moment
     *  (created at or before `at`, with no completedAt or completedAt > at). */
    activeArenaRuns: number;
    /** Bus messages in 'pending' status as of `at`. */
    pendingBusMessages: number;
  };
}

export interface TimeTravelService {
  snapshotAt(companyId: string, at: Date, opts?: { activityLimit?: number }): Promise<TimeTravelView>;
}

export function timeTravelService(db: Db): TimeTravelService {
  return {
    async snapshotAt(companyId, at, opts) {
      const limit = opts?.activityLimit ?? 200;
      const activityRows = await db
        .select()
        .from(activityLog)
        .where(and(eq(activityLog.companyId, companyId), lte(activityLog.createdAt, at)))
        .orderBy(desc(activityLog.createdAt))
        .limit(limit);

      // Most recent snapshot per (scope, scope_id) where recordedAt <= at.
      // DISTINCT ON keeps one row per group, ordered by recordedAt desc
      // so the head is the latest pre-timestamp snapshot.
      const snapshotRows = await db.execute<{
        id: string;
        scope: string;
        scope_id: string;
        label: string | null;
        snapshot: unknown;
        recorded_at: Date;
      }>(sql`
        SELECT DISTINCT ON (scope, scope_id)
          id, scope, scope_id, label, snapshot, recorded_at
        FROM ${blackBoxRecords}
        WHERE recorded_at <= ${at}
        ORDER BY scope, scope_id, recorded_at DESC
        LIMIT 200
      `);

      const [arenaActiveRow] = await db
        .select({ c: sql<string>`count(*)` })
        .from(arenaRuns)
        .where(
          and(
            eq(arenaRuns.companyId, companyId),
            lte(arenaRuns.createdAt, at),
            sql`(${arenaRuns.completedAt} IS NULL OR ${arenaRuns.completedAt} > ${at})`,
          ),
        );
      const [pendingBusRow] = await db
        .select({ c: sql<string>`count(*)` })
        .from(agentBusMessages)
        .where(
          and(
            eq(agentBusMessages.companyId, companyId),
            lte(agentBusMessages.createdAt, at),
            eq(agentBusMessages.status, "pending"),
            gte(agentBusMessages.createdAt, new Date(0)),
          ),
        );

      return {
        at: at.toISOString(),
        state: {
          activeArenaRuns: parseInt(arenaActiveRow?.c ?? "0", 10) || 0,
          pendingBusMessages: parseInt(pendingBusRow?.c ?? "0", 10) || 0,
        },
        activity: activityRows.map((r) => ({
          id: r.id,
          createdAt: r.createdAt.toISOString(),
          actorType: r.actorType,
          actorId: r.actorId,
          action: r.action,
          entityType: r.entityType,
          entityId: r.entityId,
          agentId: r.agentId ?? null,
          runId: r.runId ?? null,
          details: r.details,
        })),
        snapshots: (snapshotRows as unknown as Array<{
          id: string;
          scope: string;
          scope_id: string;
          label: string | null;
          snapshot: unknown;
          recorded_at: Date;
        }>).map((r) => ({
          id: r.id,
          scope: r.scope,
          scopeId: r.scope_id,
          label: r.label ?? null,
          snapshot: r.snapshot,
          recordedAt: r.recorded_at instanceof Date
            ? r.recorded_at.toISOString()
            : new Date(r.recorded_at).toISOString(),
        })),
      };
    },
  };
}
