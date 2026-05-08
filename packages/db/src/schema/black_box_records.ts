import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

// Append-only forensic log. Plan §19: every important run, meeting,
// hire, incident, decision gets a black-box snapshot the operator can
// replay later — context pack, prompt hash, memory snapshot, routing
// decisions, tool calls, file changes, costs, approvals, policy
// tripwires, final outcome.
//
// scope tells you what kind of thing this trace describes.
// scope_id points at the underlying row (heartbeat_runs.id,
// meetings.id, hires.id, etc).
// snapshot is intentionally untyped jsonb — the recorder writes
// whatever's relevant for that scope, and readers (cockpit drill-
// down, audit export) decode it.
//
// Multiple records per scope are allowed: each major lifecycle event
// can write a fresh snapshot. The Cockpit picks the latest by
// recordedAt, with the full series available via "trace timeline".

export const blackBoxRecords = pgTable(
  "black_box_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scope: text("scope").notNull(), // run | meeting | hire | incident | decision
    scopeId: uuid("scope_id").notNull(),
    label: text("label"), // e.g. "context_pack", "tool_call_42", "final_outcome"
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull().default({}),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    scopeRecordedIdx: index("black_box_scope_recorded_idx").on(
      table.scope,
      table.scopeId,
      table.recordedAt,
    ),
    scopeIdIdx: index("black_box_scope_id_idx").on(table.scopeId),
  }),
);
