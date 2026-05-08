import { pgTable, uuid, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { departments } from "./departments.js";

// Role templates — the catalog Nessie hires from. Seeded at first boot
// from server/src/onboarding-assets/role-templates.ts (the canonical
// list lives in code, but is mirrored to DB so operators can customize
// post-hire — edit a default name, change a tier, point at a different
// adapter — without forking the source file).
//
// `key` is the stable id ("exec.cto", "eng.reviewer", ...). `tier` is a
// soft default — the operator can override per agent on hire.
export const roleTemplates = pgTable(
  "role_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    key: text("key").notNull(),
    defaultFirstName: text("default_first_name").notNull(),
    defaultLastName: text("default_last_name").notNull(),
    title: text("title").notNull(),
    tier: text("tier").notNull(), // T1 | T2 | T3
    departmentKey: text("department_key").notNull(),
    departmentId: uuid("department_id").references(() => departments.id, { onDelete: "set null" }),
    defaultAdapterType: text("default_adapter_type").notNull().default("openai_compatible"),
    defaultAutonomyLevel: integer("default_autonomy_level").notNull().default(1),
    pitch: text("pitch").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    keyUniq: uniqueIndex("role_templates_key_uniq").on(table.key),
  }),
);
