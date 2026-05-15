import { api } from "./client";

export interface TournamentContestant {
  agentId: string;
  status: "pending" | "running" | "submitted" | "withdrawn";
  submission: string | null;
  submittedAt: string | null;
  judgeScore: number | null;
  judgeNotes: string | null;
}

export interface TournamentState {
  id: string;
  status: "open" | "judging" | "complete" | "cancelled";
  strategy: "best_of_n";
  judgeAgentId: string | null;
  winnerAgentId: string | null;
  createdAt: string;
  completedAt: string | null;
  contestants: TournamentContestant[];
}

export const tournamentsApi = {
  get: (issueRef: string) =>
    api.get<TournamentState | null>(`/issues/${encodeURIComponent(issueRef)}/tournament`),
  start: (issueRef: string, contestantAgentIds: string[], judgeAgentId?: string | null) =>
    api.post<TournamentState>(`/issues/${encodeURIComponent(issueRef)}/tournament/start`, {
      contestantAgentIds,
      judgeAgentId: judgeAgentId ?? null,
    }),
  submit: (issueRef: string, agentId: string, submission: string) =>
    api.post<TournamentState>(`/issues/${encodeURIComponent(issueRef)}/tournament/submit`, {
      agentId,
      submission,
    }),
  pickWinner: (issueRef: string, agentId: string, notes?: string) =>
    api.post<TournamentState>(`/issues/${encodeURIComponent(issueRef)}/tournament/winner`, {
      agentId,
      notes,
    }),
};
