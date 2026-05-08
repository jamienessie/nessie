import {
  type AnyPgColumn,
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { environments } from "./environments.js";
import { departments } from "./departments.js";

export const agents = pgTable(
  "agents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    // Display identity. The product rule is hard: every agent must have a
    // real human first+last name and a job title. The display name is
    // computed at the service layer (`${firstName} ${lastName}`.trim()) so
    // every API response and every UI surface renders the same string.
    // Existing rows are migrated with empty strings; the onboarding wizard
    // forces non-empty before insert. See plan Section 3.
    humanFirstName: text("human_first_name").notNull().default(""),
    humanLastName: text("human_last_name").notNull().default(""),
    name: text("name").notNull(),
    role: text("role").notNull().default("general"),
    title: text("title"),
    // Cost tier the agent operates at by default. Heartbeat stamps this on
    // X-Nessie-Tier when it invokes the proxy. Nullable so existing rows
    // don't break; new agent inserts get a tier from their role template.
    tier: text("tier"),
    // Department (Engineering, QA, HR, Finance, Policy, Product, Security,
    // Executive). Nullable so existing rows don't break; new inserts get
    // it from the role template.
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    // Autonomy level 0-5 (observe -> suggest -> create -> exec-low-risk
    // -> exec-behind-gates -> overnight). Default 1 = "suggest only".
    autonomyLevel: integer("autonomy_level").notNull().default(1),
    // Reputation score 0-100, updated by reputation_events in Phase 6.
    reputationScore: integer("reputation_score").notNull().default(50),
    // Role template id this agent was hired from, e.g. "exec.cto",
    // "eng.reviewer". Used by the UI to surface "based on Engineering Lead
    // template" pills. Nullable for ad-hoc agents.
    roleTemplateKey: text("role_template_key"),
    icon: text("icon"),
    status: text("status").notNull().default("idle"),
    reportsTo: uuid("reports_to").references((): AnyPgColumn => agents.id),
    capabilities: text("capabilities"),
    adapterType: text("adapter_type").notNull().default("process"),
    adapterConfig: jsonb("adapter_config").$type<Record<string, unknown>>().notNull().default({}),
    runtimeConfig: jsonb("runtime_config").$type<Record<string, unknown>>().notNull().default({}),
    defaultEnvironmentId: uuid("default_environment_id").references(() => environments.id, { onDelete: "set null" }),
    budgetMonthlyCents: integer("budget_monthly_cents").notNull().default(0),
    spentMonthlyCents: integer("spent_monthly_cents").notNull().default(0),
    pauseReason: text("pause_reason"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    permissions: jsonb("permissions").$type<Record<string, unknown>>().notNull().default({}),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyStatusIdx: index("agents_company_status_idx").on(table.companyId, table.status),
    companyReportsToIdx: index("agents_company_reports_to_idx").on(table.companyId, table.reportsTo),
    companyDefaultEnvironmentIdx: index("agents_company_default_environment_idx").on(table.companyId, table.defaultEnvironmentId),
    companyTierIdx: index("agents_company_tier_idx").on(table.companyId, table.tier),
    companyDepartmentIdx: index("agents_company_department_idx").on(table.companyId, table.departmentId),
  }),
);
