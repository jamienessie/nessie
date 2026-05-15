import { api } from "./client";

// Credentials read-only surface for Quota Watchdog UI.
// Backend: server/src/routes/credentials.ts.

export interface CredentialView {
  id: string;
  tier: string;
  provider: string;
  displayName: string;
  status: string;
  monthlyCapCents: number | null;
  monthlySpentCents: number;
  dailyRequestCap: number | null;
  dailyRequestCount: number;
  dailyResetAt: string | null;
  lastHealthStatus: string | null;
  lastHealthMessage: string | null;
  lastHealthAt: string | null;
}

export interface CredentialHealthObservation {
  id: string;
  observedAt: string;
  status: string;
  message: string | null;
  latencyMs: number | null;
  http429Count: number;
  http5xxCount: number;
}

export const credentialsApi = {
  list: () => api.get<{ credentials: CredentialView[] }>("/credentials"),
  health: (id: string, opts?: { limit?: number }) => {
    const q = opts?.limit ? `?limit=${opts.limit}` : "";
    return api.get<{ observations: CredentialHealthObservation[] }>(
      `/credentials/${encodeURIComponent(id)}/health${q}`,
    );
  },
};
