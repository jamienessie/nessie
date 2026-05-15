import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { heartbeatRuns } from "./heartbeat_runs.js";

// Plan §next-up. Replay Lab.
//
// One row per replay attempt. Captures the source heartbeat run (if any),
// the override knobs the operator twiddled, the resulting output, and
// the cost/latency. The Cockpit /replay page renders any replay
// side-by-side with its original to answer "would this have been
// better with model X / prompt Y / system prompt Z?".
//
// status:
//   running   — proxy fetch in flight
//   completed — output captured
//   failed    — transport / parse / non-200 error
//
// originalRunId is nullable because the operator can also start an
// ad-hoc replay from a typed prompt without basing it on a past run.

export const replayRuns = pgTable(
  "replay_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    originalRunId: uuid("original_run_id").references(() => heartbeatRuns.id, { onDelete: "set null" }),
    overrideModel: text("override_model").notNull(),
    overridePrompt: text("override_prompt").notNull(),
    overrideSystemPrompt: text("override_system_prompt"),
    status: text("status").notNull().default("running"),
    outputText: text("output_text"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    costCents: integer("cost_cents").notNull().default(0),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    requestedByUserId: text("requested_by_user_id"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyCreatedIdx: index("replay_runs_company_created_idx").on(table.companyId, table.createdAt),
    originalRunIdx: index("replay_runs_original_idx").on(table.originalRunId),
  }),
);
