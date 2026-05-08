import { and, eq } from "drizzle-orm";
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
//   4. tie-break by lowest monthlySpentCents (load balance)
//   5. final tie-break is implementation-defined but stable
//
// Returns null if no eligible credential exists. Caller must handle the
// "tier exhausted" path (502 to the agent, surface to operator).

export async function pickCredential(
  db: Db,
  tier: Tier,
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

  const eligible = rows.filter((row) =>
    row.monthlyCapCents == null || row.monthlySpentCents < row.monthlyCapCents,
  );
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
