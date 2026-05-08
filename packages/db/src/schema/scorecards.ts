import { pgTable, uuid, text, integer, timestamp, jsonb, numeric, index } from "drizzle-orm/pg-core";
import { candidates } from "./candidates.js";

// One scorecard per (candidate, evaluation pass). Multiple scorecards
// per candidate is allowed — interview pass + trial pass + final pass.
//
// rubric is an array of { criterion, weight (0..1), score (0..5), note }
// rows; totalScore is the weighted sum (0..5). recommendation is one of
// "strong_hire" | "hire" | "weak_hire" | "no_hire" | "strong_no_hire".

export const scorecards = pgTable(
  "scorecards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    candidateId: uuid("candidate_id").notNull().references(() => candidates.id, { onDelete: "cascade" }),
    pass: text("pass").notNull().default("trial"), // interview | trial | final
    rubric: jsonb("rubric").$type<Array<{
      criterion: string;
      weight: number;
      score: number;
      note?: string;
    }>>().notNull().default([]),
    totalScore: numeric("total_score", { precision: 3, scale: 2 }),
    recommendation: text("recommendation").notNull().default("weak_hire"),
    notes: text("notes"),
    scoredByAgentId: uuid("scored_by_agent_id"),
    scoredByUserId: text("scored_by_user_id"),
    scoredAt: timestamp("scored_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    starsHelper: integer("stars_helper").notNull().default(0), // optional 0..5 quick read
  },
  (table) => ({
    candidatePassIdx: index("scorecards_candidate_pass_idx").on(table.candidateId, table.pass),
  }),
);
