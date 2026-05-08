import { pgTable, uuid, timestamp, integer, index } from "drizzle-orm/pg-core";
import { credentials } from "./credentials.js";

// Monthly quota windows for subscription seats (T1) and paid APIs (T2).
//
// One row per credential per month. capCents is the imputed monthly budget
// (for T1, the seat price; for T2, the operator-set cap). spentCents is
// accumulated from cost_events writes done by the cost meter.
//
// Used by:
//   - the proxy's tier router, to skip credentials at/over cap
//   - the Cockpit Spend gauge and Subscription Health panel
//   - the Procurement Scout (Phase 7+) to flag trial expiry
export const subscriptionQuotas = pgTable(
  "subscription_quotas",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    credentialId: uuid("credential_id").notNull().references(() => credentials.id),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    windowEnd: timestamp("window_end", { withTimezone: true }).notNull(),
    capCents: integer("cap_cents"),
    spentCents: integer("spent_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    credentialWindowIdx: index("subscription_quotas_credential_window_idx").on(
      table.credentialId,
      table.windowStart,
    ),
  }),
);
