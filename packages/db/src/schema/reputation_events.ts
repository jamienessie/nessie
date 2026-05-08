import { pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";

// Reputation deltas. Plan §19: agents earn trust through reliable
// work, low policy violations, good evidence, review pass rate,
// operator acceptance — each as a delta written here. The aggregate
// (agents.reputationScore) is recomputed from the sum of recent
// events (clamped 0..100).
//
// dimension is one of:
//   quality | speed | cost_efficiency | reliability | review_pass_rate
//   | collaboration | meeting_usefulness | evidence_quality
//   | policy_compliance | operator_trust
//
// reason is a short human description ("approved by reviewer",
// "policy_check tripped", "review pass within budget").
// evidence_ref is an opaque pointer into the black-box trace if
// available.

export const reputationEvents = pgTable(
  "reputation_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    dimension: text("dimension").notNull(),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    evidenceRef: text("evidence_ref"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    agentOccurredIdx: index("reputation_events_agent_occurred_idx").on(table.agentId, table.occurredAt),
    agentDimensionIdx: index("reputation_events_agent_dimension_idx").on(table.agentId, table.dimension),
  }),
);
