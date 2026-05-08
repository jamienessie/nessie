import { pgTable, uuid, text, timestamp, integer, index } from "drizzle-orm/pg-core";
import { credentials } from "./credentials.js";

// Append-only observation log for credential health.
//
// The proxy probes each credential periodically (cheap calls — list-models,
// max_tokens=1 ping, etc.) and writes one row per probe. Subscription
// monitor in src/health.ts queries the most recent row per credentialId.
//
// Status taxonomy:
//   healthy        — last probe succeeded under threshold latency
//   degraded       — succeeded but latency spike or sporadic 5xx
//   rate_limited   — recent 429 streak; back off
//   auth_failed    — 401/403; pause the credential
//   exhausted      — quota / monthly cap hit
//   unknown        — first observation, or transport error we can't classify
export const credentialHealth = pgTable(
  "credential_health",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    credentialId: uuid("credential_id").notNull().references(() => credentials.id),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull(), // healthy | degraded | rate_limited | auth_failed | exhausted | unknown
    message: text("message"),
    latencyMs: integer("latency_ms"),
    http429Count: integer("http_429_count").notNull().default(0),
    http5xxCount: integer("http_5xx_count").notNull().default(0),
  },
  (table) => ({
    credentialObservedIdx: index("credential_health_credential_observed_idx").on(
      table.credentialId,
      table.observedAt,
    ),
  }),
);
