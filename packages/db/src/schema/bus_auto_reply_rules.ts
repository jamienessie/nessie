import { pgTable, uuid, text, timestamp, jsonb, integer, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// Plan §next-up. Bus Auto-Reply Rules.
//
// Operator-defined rules that auto-handle (dismiss / auto-reply to)
// specific bus message shapes before they hit the operator inbox.
//
// Free-tier focus: cheap agents over-ask. Without a rule engine the
// operator's inbox gets buried in trivial clarification requests,
// defeating the autonomy gain. Rules let the operator say "yes by
// default to this shape" without giving up audit (every auto-handled
// message still appears in the bus inspector with a rule chip).
//
// Match shape:
//   - kind: required exact match (one of BUS_KINDS)
//   - fromAgentIds: optional list; null/empty = any sender
//   - payloadMatch: jsonb of {key:value} equality conditions, evaluated
//                   against the inbound message payload. Empty = any
//                   payload.
//
// Action shape:
//   - "dismiss" — flip the new message to status='dismissed' immediately
//   - "auto_reply" — flip to 'replied' AND emit a sibling reply message
//     containing replyTemplate
//
// position controls evaluation order (lower runs first); first match
// wins.

export const busAutoReplyRules = pgTable(
  "bus_auto_reply_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    fromAgentIds: jsonb("from_agent_ids").$type<string[] | null>(),
    payloadMatch: jsonb("payload_match").$type<Record<string, unknown> | null>(),
    action: text("action").notNull(), // 'dismiss' | 'auto_reply'
    replyTemplate: jsonb("reply_template").$type<Record<string, unknown> | null>(),
    position: integer("position").notNull().default(0),
    enabled: text("enabled").notNull().default("true"), // text so it indexes well
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyEnabledKindIdx: index("bus_auto_reply_rules_company_enabled_kind_idx").on(
      table.companyId,
      table.enabled,
      table.kind,
    ),
  }),
);
