import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// Plan §20.1 Nessie Inbox.
//
// Universal capture: voice notes, typed ideas, screenshots, web links,
// terminal errors, GitHub issues, emails, meeting notes, PDFs, design
// sketches, logs, crash reports, "build-this-later" thoughts. Everything
// starts here. Triage flips status to one of: dismissed, saved_as_memory,
// became_issue, became_project, became_meeting, became_war_room, became_hire.
//
// Lightweight by design — it should be fast to capture (1 POST) and
// triage (1 PATCH). The body is unstructured text + optional refs;
// downstream conversion (e.g. into an issue) is handled by the operator
// via API or the Cockpit Inbox page in a follow-up.

export const inboxItems = pgTable(
  "inbox_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    kind: text("kind").notNull(), // note | voice | screenshot | link | error | doc | sketch | log | crash | other
    bodyMarkdown: text("body_markdown"),
    refs: jsonb("refs").$type<Array<{ kind: string; ref: string; summary?: string }>>().notNull().default([]),
    status: text("status").notNull().default("captured"),
    triagedAt: timestamp("triaged_at", { withTimezone: true }),
    triagedNotes: text("triaged_notes"),
    /** Pointer to whatever this item became, if anything. */
    promotedKind: text("promoted_kind"), // issue | project | meeting | war_room | hire | memory | null
    promotedId: uuid("promoted_id"),
    capturedByAgentId: uuid("captured_by_agent_id"),
    capturedByUserId: text("captured_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("inbox_items_company_status_idx").on(table.companyId, table.status),
    companyCapturedIdx: index("inbox_items_company_captured_idx").on(table.companyId, table.createdAt),
  }),
);
