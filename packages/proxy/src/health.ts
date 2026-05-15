import { desc, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { credentialHealth, credentials as credentialsTable } from "@nessie/db";
import { resolveSecret } from "./credentials.js";
import type { CredentialHealthStatus, CredentialView, Tier } from "./types.js";

// Periodic health probes for the credential pool.
//
// startHealthMonitor() returns a stop fn. By default it ticks every 5 minutes
// and runs a cheap probe per credential. The probe is intentionally tiny
// (model-list call, max_tokens=1, etc.) so it doesn't burn meaningful tokens.
//
// Each probe writes one credential_health row and may also flip the
// credentials.status field on auth_failed / exhausted observations.

const DEFAULT_TICK_MS = 5 * 60 * 1000;

export type HealthMonitor = {
  stop: () => void;
  tickNow: () => Promise<void>;
};

export function startHealthMonitor(
  db: Db,
  opts: { tickMs?: number } = {},
): HealthMonitor {
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const all = await db.select().from(credentialsTable);
      for (const row of all) {
        if (row.status === "disabled" || row.status === "paused") continue;
        await probeCredential(db, {
          id: row.id,
          tier: row.tier as Tier,
          provider: row.provider,
          displayName: row.displayName,
          secretRef: row.secretRef,
          status: row.status as CredentialView["status"],
          monthlyCapCents: row.monthlyCapCents,
          monthlySpentCents: row.monthlySpentCents,
          dailyRequestCap: row.dailyRequestCap,
          dailyRequestCount: row.dailyRequestCount,
          dailyResetAt: row.dailyResetAt,
          capabilities: row.capabilities,
        });
      }
    } catch {
      // Probe failures are recorded as credential_health rows; this catch
      // swallows orchestration errors (e.g. transient DB hiccups) so the
      // monitor stays alive.
    }
  };

  const intervalMs = opts.tickMs ?? DEFAULT_TICK_MS;
  // Defer first tick so callers don't pay for it during boot.
  timer = setInterval(() => { void tick(); }, intervalMs);
  if (typeof timer.unref === "function") timer.unref();

  return {
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    tickNow: tick,
  };
}

// Probe a single credential. Cheapest possible call per provider.
async function probeCredential(db: Db, credential: CredentialView): Promise<void> {
  const secret = resolveSecret(credential);
  if (!secret) {
    await writeHealth(db, credential.id, "auth_failed", "secret not resolved", null);
    return;
  }

  const url = probeUrlFor(credential.provider);
  if (!url) {
    // Provider has no known probe path yet (e.g. http-webhook). Treat as
    // unknown so the operator can see "we don't know its state".
    await writeHealth(db, credential.id, "unknown", "no probe URL for provider", null);
    return;
  }

  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: providerAuthHeaders(credential.provider, secret),
      signal: AbortSignal.timeout(5_000),
    });
    const latencyMs = Date.now() - startedAt;
    const status = classifyHttpStatus(res.status);
    await writeHealth(db, credential.id, status, `HTTP ${res.status}`, latencyMs);

    if (status === "auth_failed") {
      await db
        .update(credentialsTable)
        .set({ status: "auth_failed", updatedAt: new Date() })
        .where(eq(credentialsTable.id, credential.id));
    }
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const message = err instanceof Error ? err.message : String(err);
    await writeHealth(db, credential.id, "unknown", message, latencyMs);
  }
}

function probeUrlFor(provider: string): string | null {
  switch (provider) {
    case "openai":
      return "https://api.openai.com/v1/models";
    case "openrouter":
      return "https://openrouter.ai/api/v1/models";
    case "fireworks":
      return "https://api.fireworks.ai/inference/v1/models";
    case "groq":
      return "https://api.groq.com/openai/v1/models";
    case "anthropic":
      return "https://api.anthropic.com/v1/models";
    default:
      return null;
  }
}

function providerAuthHeaders(provider: string, secret: string): Record<string, string> {
  if (provider === "anthropic") {
    return { "x-api-key": secret, "anthropic-version": "2023-06-01" };
  }
  return { authorization: `Bearer ${secret}` };
}

function classifyHttpStatus(status: number): CredentialHealthStatus {
  if (status >= 200 && status < 300) return "healthy";
  if (status === 401 || status === 403) return "auth_failed";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "degraded";
  return "unknown";
}

async function writeHealth(
  db: Db,
  credentialId: string,
  status: CredentialHealthStatus,
  message: string | null,
  latencyMs: number | null,
): Promise<void> {
  await db.insert(credentialHealth).values({
    credentialId,
    status,
    message,
    latencyMs,
  });
}

// Read the most recent health row per credential. Used by the Cockpit
// Subscription Health panel and by the proxy itself when deciding whether
// to fall through to a different credential.
export async function getLatestHealth(
  db: Db,
  credentialId: string,
): Promise<CredentialHealthStatus | null> {
  const rows = await db
    .select()
    .from(credentialHealth)
    .where(eq(credentialHealth.credentialId, credentialId))
    .orderBy(desc(credentialHealth.observedAt))
    .limit(1);
  if (rows.length === 0) return null;
  return rows[0].status as CredentialHealthStatus;
}
