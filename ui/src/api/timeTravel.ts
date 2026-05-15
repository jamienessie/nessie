import { api } from "./client";

// Time Travel Inspector — backend: server/src/routes/time-travel.ts.

export interface TimeTravelActivityRow {
  id: string;
  createdAt: string;
  actorType: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId: string;
  agentId: string | null;
  runId: string | null;
  details: unknown;
}

export interface TimeTravelSnapshotRow {
  id: string;
  scope: string;
  scopeId: string;
  label: string | null;
  snapshot: unknown;
  recordedAt: string;
}

export interface TimeTravelView {
  at: string;
  activity: TimeTravelActivityRow[];
  snapshots: TimeTravelSnapshotRow[];
  state: {
    activeArenaRuns: number;
    pendingBusMessages: number;
  };
}

function qs(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export const timeTravelApi = {
  snapshot: (companyId: string, opts?: { at?: string; limit?: number }) =>
    api.get<TimeTravelView>(
      `/time-travel/snapshot${qs({
        companyId,
        at: opts?.at,
        limit: opts?.limit ? String(opts.limit) : undefined,
      })}`,
    ),
};
