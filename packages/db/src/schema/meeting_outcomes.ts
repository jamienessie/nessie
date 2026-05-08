import { pgTable, uuid, text, timestamp, jsonb, boolean, index } from "drizzle-orm/pg-core";
import { meetings } from "./meetings.js";

// Concrete outputs the meeting produced. A meeting that closes with no
// outcomes is a failed meeting per plan Principle 8.
//
// kind is one of:
//   DECIDE   — a decision record was made; payload includes options,
//              chosen path, owners, consequences
//   ACTION   — an action item; payload includes ownerAgentId, dueAt,
//              issueId? (created on operator approval)
//   MEMORY   — a fact, lesson, preference, or constraint to promote
//              into institutional memory; gated by meeting-write-policy
//   ISSUE    — a follow-up issue to create; payload is the issue draft;
//              promoted to a real issue on operator approval
//
// approvedByOperator gates whether the outcome's side effects (issue
// creation, decision-record commit, memory promotion) actually fire.
// Default false — meetings *propose*, the operator *commits*.
//
// See server/src/services/meeting-write-policy.ts for the gate.
export const meetingOutcomes = pgTable(
  "meeting_outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(), // DECIDE | ACTION | MEMORY | ISSUE
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    approvedByOperator: boolean("approved_by_operator").notNull().default(false),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    // When the outcome's effect actually landed (issue created, doc
    // written, memory promoted). Null until then.
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    meetingKindIdx: index("meeting_outcomes_meeting_kind_idx").on(table.meetingId, table.kind),
    meetingApprovedIdx: index("meeting_outcomes_meeting_approved_idx").on(table.meetingId, table.approvedByOperator),
  }),
);
