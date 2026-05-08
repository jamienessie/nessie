import { pgTable, uuid, text, timestamp, jsonb, integer, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// Plan §20.46 Operator Constitution.
//
// One editable top-level document per company. The operator's canon:
// product principles, engineering principles, spending principles, risk
// tolerance, privacy rules, meeting rules, approval rules, definition
// of done, things agents must never do.
//
// We keep it as a single row with a jsonb sections payload + version
// counter. Every save bumps the version and writes a snapshot into the
// versions table for replay / rollback.

export const operatorConstitution = pgTable(
  "operator_constitution",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    version: integer("version").notNull().default(1),
    /** sections is { product: string, engineering: string, spending: string,
     *   risk: string, privacy: string, meetings: string, approvals: string,
     *   definitionOfDone: string, neverDo: string[] } */
    sections: jsonb("sections").$type<{
      product?: string;
      engineering?: string;
      spending?: string;
      risk?: string;
      privacy?: string;
      meetings?: string;
      approvals?: string;
      definitionOfDone?: string;
      neverDo?: string[];
    }>().notNull().default({}),
    updatedByAgentId: uuid("updated_by_agent_id"),
    updatedByUserId: text("updated_by_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUniq: uniqueIndex("operator_constitution_company_uniq").on(table.companyId),
  }),
);

export const operatorConstitutionVersions = pgTable(
  "operator_constitution_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    constitutionId: uuid("constitution_id")
      .notNull()
      .references(() => operatorConstitution.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    sections: jsonb("sections").$type<Record<string, unknown>>().notNull().default({}),
    note: text("note"),
    snapshotAt: timestamp("snapshot_at", { withTimezone: true }).notNull().defaultNow(),
    snapshotByAgentId: uuid("snapshot_by_agent_id"),
    snapshotByUserId: text("snapshot_by_user_id"),
  },
  (table) => ({
    constitutionVersionIdx: index("operator_constitution_versions_idx").on(
      table.constitutionId,
      table.version,
    ),
  }),
);
