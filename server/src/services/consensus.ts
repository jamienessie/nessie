// Plan §next-up. Consensus Mode.
//
// Per-run opt-in: instead of a single primary call, the heartbeat
// dispatcher fans out the prompt to N cheap models in parallel through
// the cost-tier proxy (via the Arena pipeline) and returns the
// judge-picked winner's text as the agent's output.
//
// 3× t3 cost ≈ 1× t2 cost; quality often beats a single t2 call.
// The math only works on a free tier.
//
// Reuses arenaService.runSync() under the hood so every consensus call
// shows up as an arena run in /arena history with full audit (per-model
// outputs, scores, costs, judge reasoning).

import type { Db } from "@nessie/db";
import { arenaService } from "./arena-service.js";

export interface ConsensusInput {
  companyId: string;
  taskType?: string | null;
  prompt: string;
  models: string[];
  judgeModel?: string;
  requestedByAgentId?: string | null;
}

export interface ConsensusSuccess {
  ok: true;
  arenaRunId: string;
  winnerModel: string;
  output: string;
  costCents: number;
  latencyMs: number;
  perCandidate: Array<{
    model: string;
    status: string;
    score: number | null;
    costCents: number;
    latencyMs: number | null;
  }>;
}

export interface ConsensusFailure {
  ok: false;
  error: string;
  arenaRunId?: string;
}

export async function runConsensus(
  db: Db,
  input: ConsensusInput,
): Promise<ConsensusSuccess | ConsensusFailure> {
  if (input.models.length < 2) {
    return { ok: false, error: "consensus requires at least 2 candidate models" };
  }
  const result = await arenaService(db).runSync({
    companyId: input.companyId,
    taskType: input.taskType?.trim() || "consensus",
    prompt: input.prompt,
    candidateModels: input.models,
    judgeModel: input.judgeModel,
    requestedByAgentId: input.requestedByAgentId ?? null,
  });
  if ("ok" in result) {
    return { ok: false, error: result.error };
  }
  const run = result;
  if (run.status !== "judged" || !run.winnerModel) {
    return {
      ok: false,
      arenaRunId: run.id,
      error: run.judgeError ?? `consensus arena ended in status ${run.status}`,
    };
  }
  const winner = run.results.find((r) => r.model === run.winnerModel);
  if (!winner || !winner.outputText) {
    return { ok: false, arenaRunId: run.id, error: "winner has no output text" };
  }
  // Latency reported is the wall-clock max across candidates (parallel).
  const maxLatency = run.results.reduce(
    (acc, r) => Math.max(acc, r.latencyMs ?? 0),
    0,
  );
  return {
    ok: true,
    arenaRunId: run.id,
    winnerModel: run.winnerModel,
    output: winner.outputText,
    costCents: run.totalCostCents,
    latencyMs: maxLatency,
    perCandidate: run.results.map((r) => ({
      model: r.model,
      status: r.status,
      score: r.score,
      costCents: r.costCents,
      latencyMs: r.latencyMs,
    })),
  };
}
