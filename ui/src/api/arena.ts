import { api } from "./client";

// Plan §20.6 Model Arena surface. Backend: server/src/routes/arena.ts.

export type ArenaRunStatus = "running" | "judged" | "cancelled" | "failed";
export type ArenaResultStatus = "pending" | "completed" | "failed" | "cancelled";

export interface ArenaResult {
  id: string;
  arenaRunId: string;
  model: string;
  status: ArenaResultStatus;
  outputText: string | null;
  latencyMs: number | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costCents: number;
  score: number | null;
  judgeReasoning: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface ArenaRun {
  id: string;
  companyId: string;
  taskType: string;
  prompt: string;
  candidateModels: string[];
  judgeModel: string;
  status: ArenaRunStatus;
  winnerModel: string | null;
  judgeRubric: Record<string, unknown> | null;
  judgeNotes: string | null;
  judgeError: string | null;
  totalCostCents: number;
  requestedByAgentId: string | null;
  requestedByUserId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  results: ArenaResult[];
}

export interface ArenaLeaderboardEntry {
  model: string;
  wins: number;
  runsScored: number;
  avgScore: number;
  totalCostCents: number;
}

function qs(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export const arenaApi = {
  create: (input: {
    companyId: string;
    taskType: string;
    prompt: string;
    candidateModels: string[];
    judgeModel?: string;
  }) => api.post<{ run: ArenaRun }>("/arena/runs", input),

  list: (companyId: string, opts?: { taskType?: string; status?: ArenaRunStatus; limit?: number }) =>
    api.get<{ runs: ArenaRun[] }>(
      `/arena/runs${qs({
        companyId,
        taskType: opts?.taskType,
        status: opts?.status,
        limit: opts?.limit ? String(opts.limit) : undefined,
      })}`,
    ),

  get: (runId: string, companyId: string) =>
    api.get<{ run: ArenaRun }>(`/arena/runs/${encodeURIComponent(runId)}${qs({ companyId })}`),

  cancel: (runId: string, companyId: string) =>
    api.post<{ run: ArenaRun }>(
      `/arena/runs/${encodeURIComponent(runId)}/cancel${qs({ companyId })}`,
      {},
    ),

  leaderboard: (companyId: string, opts?: { taskType?: string }) =>
    api.get<{ entries: ArenaLeaderboardEntry[] }>(
      `/arena/leaderboard${qs({ companyId, taskType: opts?.taskType })}`,
    ),
};
