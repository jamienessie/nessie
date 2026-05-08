import { type AnyPgColumn, pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";

// Agent Bus — typed message layer between agents (and to/from the
// operator). Plan §19 Trust layer: every important coordination
// (handoff, review request, clarification, budget request, policy
// check, meeting invite, evidence request, hiring request, incident
// escalation, operator approval request) flows through this table
// instead of disappearing into prompt soup.
//
// kind values:
//   handoff                   — "I'm done; over to you"
//   review_request            — IC -> reviewer; pairs with reviewer pattern
//   clarification_request     — agent asks operator/manager
//   budget_request            — agent asks for more cents
//   policy_check              — agent asks Policy whether action is allowed
//   meeting_invite            — convene a Meeting room
//   evidence_request          — reviewer asks IC for diff/screenshots
//   hiring_request            — manager asks HR to source a role
//   incident_escalation       — anyone -> war room
//   operator_approval_request — anything that needs the operator (and
//                               also the bridge for autonomy-level
//                               gating: levels L0/L1 raise this on
//                               state-changing kinds)
//
// status: pending | delivered | replied | expired | dismissed.
// parentMessageId threads replies into the original request.
//
// Broadcast messages (to all agents in a department or company) set
// toAgentId = null and write the audience into payload.audience.

export const agentBusMessages = pgTable(
  "agent_bus_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    fromAgentId: uuid("from_agent_id").references(() => agents.id),
    toAgentId: uuid("to_agent_id").references(() => agents.id),
    kind: text("kind").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").notNull().default("pending"),
    parentMessageId: uuid("parent_message_id").references((): AnyPgColumn => agentBusMessages.id, {
      onDelete: "set null",
    }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyToStatusIdx: index("agent_bus_company_to_status_idx").on(
      table.companyId,
      table.toAgentId,
      table.status,
    ),
    companyKindIdx: index("agent_bus_company_kind_idx").on(table.companyId, table.kind),
    threadIdx: index("agent_bus_thread_idx").on(table.parentMessageId),
  }),
);
