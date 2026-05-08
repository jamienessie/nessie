import { pgTable, uuid, text, integer, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

// V1 departments per the plan. Eight default departments seeded at first
// boot (Executive, Product, Engineering, QA, Security, HR/Talent, Finance,
// Policy) plus an Operations slot kept open for v0.8 use. Each department
// owns outcomes, defaults, and a quality bar. Agents belong to one
// department via agents.departmentId.
//
// `key` is a short stable id ("eng", "qa", etc.) used in UI lookups, role
// template references (e.g. "exec.cto" -> exec department), and the
// Cockpit color tokens (--d-eng / --d-qa / --d-sec / etc.).
//
// `color` is an oklch() literal that matches the design tokens; the UI
// renders it directly as `style="--accent: oklch(...)"`.
export const departments = pgTable(
  "departments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    key: text("key").notNull(), // exec | prod | eng | qa | sec | hr | fin | pol | ops
    name: text("name").notNull(),
    color: text("color").notNull(), // oklch literal, e.g. "oklch(0.78 0.22 270)"
    mission: text("mission").notNull(),
    defaultPreferredTier: text("default_preferred_tier").notNull().default("T2"),
    defaultBudgetMonthlyCents: integer("default_budget_monthly_cents").notNull().default(0),
    allowedTools: jsonb("allowed_tools").$type<string[]>().notNull().default([]),
    qualityStandards: jsonb("quality_standards").$type<string[]>().notNull().default([]),
    scorecardTemplate: jsonb("scorecard_template").$type<Array<{
      criterion: string;
      weight: number;
      description?: string;
    }>>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyKeyUniq: uniqueIndex("departments_company_key_uniq").on(table.companyId, table.key),
  }),
);
