import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { departments } from "./departments.js";

// A hire is a request to bring a new agent into the company. The 5-stage
// pipeline (matches plan §14):
//   open         — operator/manager/Meeting proposed the role
//   sourcing     — HR proposes candidates from templates / aliases
//   interviewing — interview Meeting in progress
//   trial        — candidate runs a scored trial issue (T3 credential only)
//   recommended  — HR submits a hire packet to the operator
//   hired        — operator approved; agent has been minted
//   rejected     — closed without a hire (any stage)
//
// Trial agents NEVER get T1 or T2 credentials. The hires service
// enforces this at the API boundary (refuses to mint a non-T3
// credential against a candidate row that has not yet transitioned to
// 'hired').

export const hires = pgTable(
  "hires",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    requestedRoleTemplateKey: text("requested_role_template_key"),
    requestedDepartmentId: uuid("requested_department_id").references(() => departments.id, { onDelete: "set null" }),
    requestedTier: text("requested_tier").notNull().default("T2"), // T1|T2|T3
    status: text("status").notNull().default("open"),
    title: text("title").notNull(),
    description: text("description"),
    // Free-form packet the wizard / HR builds up: target capabilities,
    // budget envelope, acceptance criteria, notes from interview Meetings.
    packet: jsonb("packet").$type<Record<string, unknown>>().notNull().default({}),
    createdByAgentId: uuid("created_by_agent_id"),
    createdByUserId: text("created_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("hires_company_status_idx").on(table.companyId, table.status),
    companyTierIdx: index("hires_company_tier_idx").on(table.companyId, table.requestedTier),
  }),
);
