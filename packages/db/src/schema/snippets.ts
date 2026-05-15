import { pgTable, uuid, text, timestamp, integer, uniqueIndex, index } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// Plan §next-up. Snippet Library — operator-curated, versioned prompt
// snippets reusable across Arena Compose, agent instructions editor,
// Replay Lab, etc.
//
// snippets is the head row (latest body for the snippet);
// snippet_revisions is the immutable history. (key, companyId) is
// unique so the operator can refer to snippets by stable handle from
// other surfaces (e.g. arena.compose("summarize_3_bullets")).
//
// On free tier the prompt that gets the best output from a cheap model
// is a moving target — providers swap weights, models drift. A
// versioned snippet library lets the operator iterate the prompt
// without touching every consumer.

export const snippets = pgTable(
  "snippets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    key: text("key").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    version: integer("version").notNull().default(1),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyKeyUniq: uniqueIndex("snippets_company_key_uniq").on(table.companyId, table.key),
    companyIdx: index("snippets_company_idx").on(table.companyId),
  }),
);

export const snippetRevisions = pgTable(
  "snippet_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snippetId: uuid("snippet_id").notNull().references(() => snippets.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    note: text("note"),
    snapshotByUserId: text("snapshot_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    snippetVersionUniq: uniqueIndex("snippet_revisions_snippet_version_uniq").on(
      table.snippetId,
      table.version,
    ),
  }),
);
