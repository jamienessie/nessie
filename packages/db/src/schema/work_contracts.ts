import { pgTable, uuid, text, integer, timestamp, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";
import { issues } from "./issues.js";
import { agents } from "./agents.js";

// Work Contracts. Per plan Principle 13: "Work is contracted before
// executed." Every important issue can carry a contract that nails
// down acceptance criteria, evidence to produce, allowed/forbidden
// tools, budget envelope, deadline, escalation policy.
//
// One contract per issue (uniqueness on issueId). state machine:
//   draft -> active -> {satisfied, escalated, cancelled}
//   satisfied / escalated / cancelled are terminal.
//
// acceptance_criteria mirrors the field on issues but is more
// structured (each row may carry weight, evidence-refs, scorer).
// evidence is a list of pointers (file/diff/test-run/screenshot/
// log/meeting-quote/cost-event/run-event/decision-record).
// tool_boundaries: { allowed: string[], forbidden: string[],
//                    requireApproval: string[] }.
// escalation_policy: { onTimeout, onBudgetBreach, onSecurityAlert }.

export const workContracts = pgTable(
  "work_contracts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    ownerAgentId: uuid("owner_agent_id").references(() => agents.id),
    reviewerAgentId: uuid("reviewer_agent_id").references(() => agents.id),
    acceptanceCriteria: jsonb("acceptance_criteria").$type<Array<{
      criterion: string;
      weight?: number;
      evidenceRequired?: string[];
      met?: boolean;
    }>>().notNull().default([]),
    evidence: jsonb("evidence").$type<Array<{
      kind: string;
      ref: string;
      summary?: string;
      addedAt?: string;
    }>>().notNull().default([]),
    toolBoundaries: jsonb("tool_boundaries").$type<{
      allowed?: string[];
      forbidden?: string[];
      requireApproval?: string[];
    }>().notNull().default({}),
    budgetCents: integer("budget_cents").notNull().default(0),
    spentCents: integer("spent_cents").notNull().default(0),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    escalationPolicy: jsonb("escalation_policy").$type<{
      onTimeout?: string;
      onBudgetBreach?: string;
      onSecurityAlert?: string;
    }>().notNull().default({}),
    state: text("state").notNull().default("draft"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    issueUniq: uniqueIndex("work_contracts_issue_uniq").on(table.issueId),
    ownerStateIdx: index("work_contracts_owner_state_idx").on(table.ownerAgentId, table.state),
    reviewerStateIdx: index("work_contracts_reviewer_state_idx").on(table.reviewerAgentId, table.state),
  }),
);
