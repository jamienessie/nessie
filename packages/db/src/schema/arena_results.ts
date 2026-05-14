import { pgTable, uuid, text, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { arenaRuns } from "./arena_runs.js";

// One row per candidate model invocation in an arena run.
//
// latency_ms lives here (not in cost_events — cost_events has no latency
// column). Token + cost columns are denormalized from the proxy's
// cost_events row after the call settles; the canonical source remains
// cost_events.
//
// status:
//   pending    — fan-out launched, awaiting upstream response
//   completed  — model returned a response
//   failed     — non-200, parse failure, or transport error
//   cancelled  — operator cancelled while in-flight

export const arenaResults = pgTable(
  "arena_results",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    arenaRunId: uuid("arena_run_id").notNull().references(() => arenaRuns.id, { onDelete: "cascade" }),
    model: text("model").notNull(),
    status: text("status").notNull().default("pending"),
    outputText: text("output_text"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens").notNull().default(0),
    cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    score: integer("score"),
    judgeReasoning: text("judge_reasoning"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    runIdx: index("arena_results_run_idx").on(table.arenaRunId),
    runModelUniq: uniqueIndex("arena_results_run_model_uniq").on(table.arenaRunId, table.model),
  }),
);
