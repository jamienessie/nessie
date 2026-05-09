import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
  integer,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// Plug-In Janitor sweep audit row.
//
// One row per sweep. Stores what Hank Brennan scanned, what he swapped,
// what he paused, and (best-effort) the Gemini-Flash-written one-paragraph
// summary the operator sees on the Plug-In Janitor page. Long-lived adapter
// outages live in `janitor_outages` (one row per outage, surviving across
// sweeps until resolved); per-sweep records are this table.

export type JanitorReportScope =
  | { kind: "all" }
  | { kind: "agent"; agentId: string };

export type JanitorReportSwap = {
  agentId: string;
  agentLabel: string;
  from: { adapterType: string; model: string };
  to: { adapterType: string; model: string };
  reason: string;
};

export type JanitorReportPause = {
  agentId: string;
  agentLabel: string;
  binding: { adapterType: string; model: string };
  reason: string;
};

export const janitorReports = pgTable(
  "janitor_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    triggeredBy: text("triggered_by").notNull(),
    triggeredByUserId: text("triggered_by_user_id"),
    scope: jsonb("scope").$type<JanitorReportScope>().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull().default("running"),
    scannedCount: integer("scanned_count").notNull().default(0),
    healthyCount: integer("healthy_count").notNull().default(0),
    swappedCount: integer("swapped_count").notNull().default(0),
    pausedCount: integer("paused_count").notNull().default(0),
    skippedCooldownCount: integer("skipped_cooldown_count").notNull().default(0),
    outagesDetectedCount: integer("outages_detected_count").notNull().default(0),
    swaps: jsonb("swaps").$type<JanitorReportSwap[]>().notNull().default([]),
    pauses: jsonb("pauses").$type<JanitorReportPause[]>().notNull().default([]),
    summaryProse: text("summary_prose"),
    summarySource: text("summary_source"),
    errorMessage: text("error_message"),
  },
  (table) => ({
    companyStartedIdx: index("janitor_reports_company_started_idx").on(
      table.companyId,
      table.startedAt,
    ),
  }),
);
