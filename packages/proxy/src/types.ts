// Shared types for the cost-tier proxy.

export type Tier = "T1" | "T2" | "T3";

export type TosAwareness = "Conservative" | "Standard" | "Aggressive";

export type CredentialStatus =
  | "active"
  | "paused"
  | "exhausted"
  | "auth_failed"
  | "disabled";

export type CredentialHealthStatus =
  | "healthy"
  | "degraded"
  | "rate_limited"
  | "auth_failed"
  | "exhausted"
  | "unknown";

// Subset of the credentials row exposed to the router. Doesn't include the
// resolved secret — the secret resolver is called explicitly per-request.
export type CredentialView = {
  id: string;
  tier: Tier;
  provider: string;
  displayName: string;
  secretRef: string;
  status: CredentialStatus;
  monthlyCapCents: number | null;
  monthlySpentCents: number;
  capabilities: string[];
};

// Resolved provider call target: who to ask, with what.
export type ProviderTarget = {
  credential: CredentialView;
  upstreamUrl: string;
  upstreamModel: string;
};

// Headers Nessie expects on inbound proxy requests. All optional except in
// production; defaults are filled in from the model alias and instance config.
export const NESSIE_TIER_HEADER = "x-nessie-tier";
export const NESSIE_AGENT_HEADER = "x-nessie-agent-id";
export const NESSIE_HEARTBEAT_HEADER = "x-nessie-heartbeat-run-id";
export const NESSIE_COMPANY_HEADER = "x-nessie-company-id";
