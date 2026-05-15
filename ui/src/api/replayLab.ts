import { api } from "./client";

// Replay Lab — backend: server/src/routes/replay-lab.ts.

export type ReplayStatus = "running" | "completed" | "failed";

export interface ReplayRun {
  id: string;
  companyId: string;
  originalRunId: string | null;
  overrideModel: string;
  overridePrompt: string;
  overrideSystemPrompt: string | null;
  status: ReplayStatus;
  outputText: string | null;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
  latencyMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  requestedByUserId: string | null;
  completedAt: string | null;
  createdAt: string;
}

function qs(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export const replayLabApi = {
  create: (input: {
    companyId: string;
    overrideModel: string;
    overridePrompt: string;
    overrideSystemPrompt?: string | null;
    originalRunId?: string | null;
  }) => api.post<{ replay: ReplayRun }>("/replay/runs", input),
  list: (companyId: string, opts?: { limit?: number }) =>
    api.get<{ replays: ReplayRun[] }>(
      `/replay/runs${qs({ companyId, limit: opts?.limit ? String(opts.limit) : undefined })}`,
    ),
  get: (id: string, companyId: string) =>
    api.get<{ replay: ReplayRun; original: { id: string; resultJson: unknown } | null }>(
      `/replay/runs/${encodeURIComponent(id)}${qs({ companyId })}`,
    ),
};
