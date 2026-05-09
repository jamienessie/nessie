import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { agents } from "./agents.js";
import { companies } from "./companies.js";
import { janitorReports } from "./janitor_reports.js";

// Long-lived adapter-outage tracker.
//
// Created when Hank's sweep concludes that an entire adapter is broken
// (>=80% of attempted models fail with a single dominant error code).
// Survives across sweeps; resolved when a later sweep finds >=50% of
// previously-failed models passing. Hard unique index prevents duplicate
// open outages on the same (company, adapter, dominantErrorCode).

export type JanitorOutageStatus = "open" | "in_progress" | "resolved" | "abandoned";

export type JanitorOutageErrorPattern = {
  attempted: number;
  failed: number;
  /** First few distinct error messages, truncated for storage. */
  sampleMessages: string[];
  failedModels: string[];
};

export const janitorOutages = pgTable(
  "janitor_outages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    adapterType: text("adapter_type").notNull(),
    dominantErrorCode: text("dominant_error_code").notNull(),
    detectedAt: timestamp("detected_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    status: text("status").notNull().default("open"),
    detectedInReportId: uuid("detected_in_report_id").references(() => janitorReports.id, { onDelete: "set null" }),
    errorPattern: jsonb("error_pattern").$type<JanitorOutageErrorPattern>().notNull(),
    affectedAgentIds: jsonb("affected_agent_ids").$type<string[]>().notNull().default([]),
    /** Hank's drafted plan markdown (Gemini-Flash, or deterministic-fallback when Gemini itself is the broken adapter). */
    planMarkdown: text("plan_markdown").notNull(),
    /** "hank_gemini" | "deterministic_fallback" */
    planSource: text("plan_source").notNull().default("hank_gemini"),
    /** FK is intentionally not declared so this schema does not import issues.ts (avoids cycles). */
    escalatedIssueId: uuid("escalated_issue_id"),
    assigneeAgentId: uuid("assignee_agent_id").references(() => agents.id, { onDelete: "set null" }),
    lastObservedAt: timestamp("last_observed_at", { withTimezone: true }).notNull().defaultNow(),
    observationCount: integer("observation_count").notNull().default(1),
  },
  (table) => ({
    companyAdapterStatusIdx: index("janitor_outages_company_adapter_status_idx").on(
      table.companyId,
      table.adapterType,
      table.status,
    ),
    companyStatusDetectedIdx: index("janitor_outages_company_status_detected_idx").on(
      table.companyId,
      table.status,
      table.detectedAt,
    ),
    openUnique: uniqueIndex("janitor_outages_open_unique_idx")
      .on(table.companyId, table.adapterType, table.dominantErrorCode)
      .where(sql`status in ('open', 'in_progress')`),
  }),
);
