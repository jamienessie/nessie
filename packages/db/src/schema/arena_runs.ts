import { pgTable, uuid, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { agents } from "./agents.js";

// Plan §20.6 Model Arena.
//
// An arena run fans the same prompt out to N candidate models in parallel
// through the cost-tier proxy, then asks a judge model to rank the
// outputs. Standalone-only in v1 (no issue context, no agent-callable).
//
// status:
//   running   — fan-out in flight (one or more results in pending)
//   judged    — judge call succeeded; winner set
//   cancelled — operator cancelled before judge ran
//   failed    — every candidate failed or the judge call failed; treat the
//               run as unusable

export const arenaRuns = pgTable(
  "arena_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    taskType: text("task_type").notNull(),
    prompt: text("prompt").notNull(),
    candidateModels: jsonb("candidate_models").$type<string[]>().notNull(),
    judgeModel: text("judge_model").notNull(),
    status: text("status").notNull().default("running"),
    winnerModel: text("winner_model"),
    judgeRubric: jsonb("judge_rubric").$type<Record<string, unknown> | null>(),
    judgeNotes: text("judge_notes"),
    judgeError: text("judge_error"),
    totalCostCents: integer("total_cost_cents").notNull().default(0),
    requestedByAgentId: uuid("requested_by_agent_id").references(() => agents.id),
    requestedByUserId: text("requested_by_user_id"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("arena_runs_company_created_idx").on(table.companyId, table.createdAt),
    companyTaskTypeCompletedIdx: index("arena_runs_company_task_type_completed_idx").on(
      table.companyId,
      table.taskType,
      table.completedAt,
    ),
  }),
);
