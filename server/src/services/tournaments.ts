import { and, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { issues, agents } from "@nessie/db";
import { notFound, unprocessable } from "../errors.js";

// Agent Tournaments — "best of N".
//
// For any issue, the operator picks N contestant agents. Each contestant
// tackles the issue in parallel; a judge agent (or the operator) picks the
// winner. MVP scope: persist tournament structure under
// `issues.executionState.tournament` (no migration), expose CRUD + a manual
// "submit" / "pick winner" flow. Hook for real heartbeat invocation of
// contestants is isolated to a single `spawnContestants` call that the
// MVP leaves stubbed so the data model can ship today.

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

interface IssueExecutionState {
  tournament?: TournamentState;
  [key: string]: unknown;
}

function readExecutionState(row: typeof issues.$inferSelect): IssueExecutionState {
  return (row.executionState ?? {}) as IssueExecutionState;
}

export function tournamentService(db: Db) {
  async function getIssue(companyId: string, issueId: string) {
    const row = await db
      .select()
      .from(issues)
      .where(and(eq(issues.id, issueId), eq(issues.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Issue not found");
    return row;
  }

  async function writeTournament(
    companyId: string,
    issueId: string,
    tournament: TournamentState | null,
  ): Promise<typeof issues.$inferSelect> {
    const row = await getIssue(companyId, issueId);
    const state = readExecutionState(row);
    const nextState: IssueExecutionState = { ...state };
    if (tournament === null) {
      delete nextState.tournament;
    } else {
      nextState.tournament = tournament;
    }
    const updated = await db
      .update(issues)
      .set({ executionState: nextState, updatedAt: new Date() })
      .where(eq(issues.id, issueId))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!updated) throw notFound("Issue not found after update");
    return updated;
  }

  return {
    async get(companyId: string, issueId: string): Promise<TournamentState | null> {
      const row = await getIssue(companyId, issueId);
      const state = readExecutionState(row);
      return state.tournament ?? null;
    },

    async start(
      companyId: string,
      issueId: string,
      input: { contestantAgentIds: string[]; judgeAgentId?: string | null },
    ): Promise<TournamentState> {
      const ids = Array.from(new Set(input.contestantAgentIds.filter((id) => typeof id === "string" && id.length > 0)));
      if (ids.length < 2) {
        throw unprocessable("A tournament needs at least 2 contestants");
      }
      if (ids.length > 8) {
        throw unprocessable("Max 8 contestants per tournament for MVP");
      }

      // Validate agents belong to the same company.
      const rows = await db
        .select({ id: agents.id, companyId: agents.companyId })
        .from(agents)
        .where(eq(agents.companyId, companyId));
      const companyAgentIds = new Set(rows.map((r) => r.id));
      for (const id of ids) {
        if (!companyAgentIds.has(id)) {
          throw unprocessable(`Agent ${id} is not part of this company`);
        }
      }
      if (input.judgeAgentId && !companyAgentIds.has(input.judgeAgentId)) {
        throw unprocessable("Judge agent must belong to this company");
      }

      const now = new Date().toISOString();
      const tournament: TournamentState = {
        id: `tour_${Math.random().toString(36).slice(2, 10)}`,
        status: "open",
        strategy: "best_of_n",
        judgeAgentId: input.judgeAgentId ?? null,
        winnerAgentId: null,
        createdAt: now,
        completedAt: null,
        contestants: ids.map((agentId) => ({
          agentId,
          status: "pending",
          submission: null,
          submittedAt: null,
          judgeScore: null,
          judgeNotes: null,
        })),
      };

      const updated = await writeTournament(companyId, issueId, tournament);
      const next = readExecutionState(updated).tournament;
      if (!next) throw new Error("Failed to persist tournament");

      // Stubbed: spawn contestants in a real system. For the MVP we don't
      // invoke the heartbeat — adapters need a `tournament_contestant`
      // wake reason hook that doesn't exist yet. The operator can manually
      // mark contestants as submitted via `submit()` below in the meantime.
      return next;
    },

    async submit(
      companyId: string,
      issueId: string,
      input: { agentId: string; submission: string },
    ): Promise<TournamentState> {
      const row = await getIssue(companyId, issueId);
      const state = readExecutionState(row);
      const tournament = state.tournament;
      if (!tournament) throw unprocessable("No tournament running on this issue");
      const contestant = tournament.contestants.find((c) => c.agentId === input.agentId);
      if (!contestant) throw unprocessable("Agent is not a contestant in this tournament");
      contestant.status = "submitted";
      contestant.submission = input.submission;
      contestant.submittedAt = new Date().toISOString();
      const allDone = tournament.contestants.every((c) => c.status === "submitted" || c.status === "withdrawn");
      if (allDone) tournament.status = "judging";
      const updated = await writeTournament(companyId, issueId, tournament);
      const next = readExecutionState(updated).tournament;
      if (!next) throw new Error("Failed to persist tournament");
      return next;
    },

    async pickWinner(
      companyId: string,
      issueId: string,
      input: { agentId: string; notes?: string },
    ): Promise<TournamentState> {
      const row = await getIssue(companyId, issueId);
      const state = readExecutionState(row);
      const tournament = state.tournament;
      if (!tournament) throw unprocessable("No tournament running on this issue");
      const winner = tournament.contestants.find((c) => c.agentId === input.agentId);
      if (!winner) throw unprocessable("Winner must be one of the contestants");
      winner.judgeScore = (winner.judgeScore ?? 0) + 1;
      if (input.notes) winner.judgeNotes = input.notes;
      tournament.winnerAgentId = input.agentId;
      tournament.status = "complete";
      tournament.completedAt = new Date().toISOString();
      const updated = await writeTournament(companyId, issueId, tournament);
      const next = readExecutionState(updated).tournament;
      if (!next) throw new Error("Failed to persist tournament");
      return next;
    },

    async cancel(companyId: string, issueId: string): Promise<void> {
      const row = await getIssue(companyId, issueId);
      const state = readExecutionState(row);
      const tournament = state.tournament;
      if (!tournament) return;
      tournament.status = "cancelled";
      tournament.completedAt = new Date().toISOString();
      await writeTournament(companyId, issueId, tournament);
    },
  };
}
