import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

// Plan §next-up. Operator-curated persistent notes per agent, prepended
// to the agent's system prompt at heartbeat dispatch time.
//
// Free-tier focus: cheap models follow instructions less reliably than
// frontier models, so the operator's standing guidance has to be
// re-asserted every run. Coaching Notes turns "I keep telling this
// agent the same thing" into a one-time act that compounds.
//
// status:
//   active   — included in the next run's prompt prefix
//   archived — kept for history, not included
//
// position is the operator's preferred ordering when multiple notes apply
// (lower numbers come first). Ties broken by createdAt asc so older notes
// stay stable when new ones are inserted.

export const agentCoachingNotes = pgTable(
  "agent_coaching_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
    body: text("body").notNull(),
    status: text("status").notNull().default("active"),
    position: integer("position").notNull().default(0),
    authoredByUserId: text("authored_by_user_id"),
    archivedByUserId: text("archived_by_user_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyAgentStatusIdx: index("agent_coaching_notes_company_agent_status_idx").on(
      table.companyId,
      table.agentId,
      table.status,
    ),
  }),
);
