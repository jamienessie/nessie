import { pgTable, uuid, text, timestamp, integer, index, uniqueIndex } from "drizzle-orm/pg-core";

// Nessie cost-tier credentials.
//
// One row per (provider account) the operator has connected. Each credential
// belongs to exactly one tier:
//   T1 — subscription seats (Claude Max, Cursor Pro, Codex Plus). Sunk cost,
//        $0/call accounting. Cookie-based auth, gated by the TOS dial.
//   T2 — paid APIs (Anthropic, OpenAI, Bedrock, Vertex, Azure). Per-token,
//        capped by monthlyCapCents. The bulk of judgment work lives here.
//   T3 — free tier / trial credit (OpenRouter free, Fireworks free, GCP/AWS
//        trial). Cheap or zero per-call, but quota-bounded.
//
// secretRef is an opaque pointer into the secret store. In v1 it is an
// environment-variable name (e.g. "OPENAI_API_KEY_PRIMARY"). When we move
// secrets to OS keychain, the resolver changes — the schema does not.
//
// Credentials are instance-scoped, not company-scoped. A solo operator owns
// every credential; companies inherit the pool.
export const credentials = pgTable(
  "credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tier: text("tier").notNull(), // 'T1' | 'T2' | 'T3'
    provider: text("provider").notNull(), // openai | anthropic | bedrock | vertex | azure | openrouter | claude-max | cursor | codex | http-webhook | ...
    displayName: text("display_name").notNull(),
    secretRef: text("secret_ref").notNull(), // env-var name in v1; later: keychain handle
    status: text("status").notNull().default("active"), // active | paused | exhausted | auth_failed | disabled
    monthlyCapCents: integer("monthly_cap_cents"), // null = no cap
    monthlySpentCents: integer("monthly_spent_cents").notNull().default(0),
    // Plan §next-up Quota Watchdog. Free credentials (T3) are typically
    // bound by daily request count, not by $-spend. Watchdog rotates
    // credentials before hitting the daily cap; counts reset at
    // dailyResetAt (UTC midnight by default, configurable per provider).
    dailyRequestCap: integer("daily_request_cap"), // null = no cap
    dailyRequestCount: integer("daily_request_count").notNull().default(0),
    dailyResetAt: timestamp("daily_reset_at", { withTimezone: true }),
    capabilities: text("capabilities").array().notNull().default([]), // ['tool_calling','coding','vision','reasoning']
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tierStatusIdx: index("credentials_tier_status_idx").on(table.tier, table.status),
    providerIdx: index("credentials_provider_idx").on(table.provider),
    displayNameUniq: uniqueIndex("credentials_display_name_uniq").on(table.displayName),
  }),
);
