import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { hires } from "./hires.js";
import { agents } from "./agents.js";
import { issues } from "./issues.js";

// One row per candidate considered for a hire. Has the candidate's
// proposed human name (which the operator can edit before the offer
// goes through), a short summary, optional long-form resume markdown.
//
// status moves: proposed -> interviewing -> trial -> recommended ->
//               offered -> {accepted (= hired), declined, rejected}
//
// agentId is null until the candidate is hired and an agents row is
// minted. trialIssueId points at the issue the candidate worked
// during trial — that issue's outcome feeds the scorecard.

export const candidates = pgTable(
  "candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    hireId: uuid("hire_id").notNull().references(() => hires.id, { onDelete: "cascade" }),
    humanFirstName: text("human_first_name").notNull(),
    humanLastName: text("human_last_name").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    resumeMarkdown: text("resume_markdown"),
    status: text("status").notNull().default("proposed"),
    sourceTemplateKey: text("source_template_key"),
    proposedAdapterType: text("proposed_adapter_type"),
    // Trial work product. The trial issue must run on a T3 credential.
    trialIssueId: uuid("trial_issue_id").references(() => issues.id, { onDelete: "set null" }),
    // The minted agent record once hired. Null until offer accepted.
    agentId: uuid("agent_id").references(() => agents.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    hireStatusIdx: index("candidates_hire_status_idx").on(table.hireId, table.status),
  }),
);
