import { pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";
import { departments } from "./departments.js";
import { documents } from "./documents.js";

// Meetings are first-class (per plan Principle 8 "Meetings create decisions,
// not noise"). A Meeting is a live multi-agent room: operator summons
// selected agents to plan, review, debug, interview, or decide. The
// lifecycle state machine in services/meetings.ts drives transitions.
//
// A Meeting that produces only chat is a *failed* Meeting — every closed
// Meeting must have at least one meeting_outcome row.

export const meetings = pgTable(
  "meetings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    // Modes per plan Section 13. operator_led is the default.
    mode: text("mode").notNull().default("operator_led"),
    // Lifecycle state. State machine in services/meetings.ts validates
    // transitions:
    //   draft -> preparing -> active -> {synthesizing, waiting_for_operator}
    //   synthesizing -> completed
    //   any -> abandoned | failed
    state: text("state").notNull().default("draft"),
    title: text("title").notNull(),
    agendaMarkdown: text("agenda_markdown"),
    // Optional department association — used by the UI for color-coding
    // and by the cost-tier router to bias participant selection toward
    // the department's preferred tier.
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    facilitatorAgentId: uuid("facilitator_agent_id").references(() => agents.id),
    // Cost meter. spentCents is summed from meeting_messages.costCents
    // by the service on every message append.
    budgetCents: integer("budget_cents").notNull().default(0),
    spentCents: integer("spent_cents").notNull().default(0),
    // Turn limits. The orchestrator stops scheduling agent turns when
    // turnIndex >= turnLimit, transitioning the meeting to synthesizing.
    turnLimit: integer("turn_limit").notNull().default(30),
    turnIndex: integer("turn_index").notNull().default(0),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    // The synthesised summary document, written when the Meeting moves
    // to completed. Null until then.
    artifactDocumentId: uuid("artifact_document_id").references(() => documents.id, { onDelete: "set null" }),
    createdByAgentId: uuid("created_by_agent_id").references(() => agents.id),
    createdByUserId: text("created_by_user_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStateIdx: index("meetings_company_state_idx").on(table.companyId, table.state),
    companyDepartmentIdx: index("meetings_company_department_idx").on(table.companyId, table.departmentId),
    companyScheduledIdx: index("meetings_company_scheduled_idx").on(table.companyId, table.scheduledAt),
  }),
);
