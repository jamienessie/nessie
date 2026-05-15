import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { credentials as credentialsTable } from "@nessie/db";
import type { CredentialStatus, CredentialView, Tier } from "./types.js";

// Credential pool selection.
//
// Picks one credential of the requested tier, biased toward "least loaded
// healthy candidate". Status filter excludes paused / exhausted / auth_failed
// / disabled.
//
// Selection rules (v1):
//   1. tier match exact
//   2. status === 'active'
//   3. monthlyCapCents null OR monthlySpentCents < monthlyCapCents
//   4. dailyRequestCap null OR dailyRequestCount < dailyRequestCap (after
//      reset-window check)
//   5. tie-break by lowest monthlySpentCents (load balance)
//   6. final tie-break is implementation-defined but stable
//
// Returns null if no eligible credential exists. Caller must handle the
// "tier exhausted" path (502 to the agent, surface to operator).

function nextDailyResetAt(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setUTCHours(24, 0, 0, 0);
  return d;
}

function isPastReset(resetAt: Date | null, now: Date = new Date()): boolean {
  if (!resetAt) return false;
  return now.getTime() >= resetAt.getTime();
}

export async function pickCredential(
  db: Db,
  tier: Tier,
  opts: { excludeCredentialIds?: string[] } = {},
): Promise<CredentialView | null> {
  const rows = await db
    .select()
    .from(credentialsTable)
    .where(
      and(
        eq(credentialsTable.tier, tier),
        eq(credentialsTable.status, "active" satisfies CredentialStatus),
      ),
    );

  if (rows.length === 0) return null;

  const exclude = new Set(opts.excludeCredentialIds ?? []);
  const now = new Date();
  const eligible = rows.filter((row) => {
    if (exclude.has(row.id)) return false;
    if (row.monthlyCapCents != null && row.monthlySpentCents >= row.monthlyCapCents) return false;
    if (row.dailyRequestCap != null) {
      // If we're past the reset window, the row will get reset on the next
      // increment — treat its current count as 0 for eligibility.
      const effectiveCount = isPastReset(row.dailyResetAt, now) ? 0 : row.dailyRequestCount;
      if (effectiveCount >= row.dailyRequestCap) return false;
    }
    return true;
  });
  if (eligible.length === 0) return null;

  eligible.sort((a, b) => a.monthlySpentCents - b.monthlySpentCents);
  const winner = eligible[0];

  return {
    id: winner.id,
    tier: winner.tier as Tier,
    provider: winner.provider,
    displayName: winner.displayName,
    secretRef: winner.secretRef,
    status: winner.status as CredentialStatus,
    monthlyCapCents: winner.monthlyCapCents,
    monthlySpentCents: winner.monthlySpentCents,
    dailyRequestCap: winner.dailyRequestCap,
    dailyRequestCount: winner.dailyRequestCount,
    dailyResetAt: winner.dailyResetAt,
    capabilities: winner.capabilities,
  };
}

// Resolve the actual secret value for a credential. v1 looks up an env var
// by name; later this becomes a keychain/keytar lookup.
export function resolveSecret(
  credential: CredentialView,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = env[credential.secretRef]?.trim();
  return value && value.length > 0 ? value : null;
}

// Quota Watchdog: increment a credential's daily request counter atomically,
// wrapping the daily reset if needed. Called after a successful proxy call.
export async function recordDailyRequest(db: Db, credentialId: string): Promise<void> {
  const now = new Date();
  const reset = nextDailyResetAt(now);
  // Reset the counter if we're past the previous reset window, otherwise
  // increment. Done in a single SQL expression so concurrent calls don't
  // lose increments.
  await db
    .update(credentialsTable)
    .set({
      dailyRequestCount: sql`CASE WHEN ${credentialsTable.dailyResetAt} IS NULL OR ${credentialsTable.dailyResetAt} <= ${now} THEN 1 ELSE ${credentialsTable.dailyRequestCount} + 1 END`,
      dailyResetAt: sql`CASE WHEN ${credentialsTable.dailyResetAt} IS NULL OR ${credentialsTable.dailyResetAt} <= ${now} THEN ${reset} ELSE ${credentialsTable.dailyResetAt} END`,
      updatedAt: now,
    })
    .where(eq(credentialsTable.id, credentialId));
}

// Mark a credential as exhausted (typically after observing a 429 with no
// retry-after window we trust). Watchdog re-tries with the next eligible
// credential of the same tier.
export async function markExhausted(db: Db, credentialId: string): Promise<void> {
  await db
    .update(credentialsTable)
    .set({ status: "exhausted", updatedAt: new Date() })
    .where(eq(credentialsTable.id, credentialId));
}
