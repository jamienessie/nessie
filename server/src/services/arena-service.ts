// Plan §20.6 Model Arena service.
//
// Fans the same prompt out to N candidate models through the cost-tier
// proxy, then delegates to arena-judge.ts to rank the outputs. Standalone
// only in v1 (operator-initiated; not agent-callable; not issue-attached).
//
// Lifecycle:
//   create()       — insert arena_runs (status=running) + N arena_results
//                    (status=pending). Returns immediately.
//   start(runId)   — fan out N proxy calls in parallel via one shared
//                    AbortController. As each settles, write to the
//                    corresponding arena_results row and emit
//                    arena.run.result_landed. After all settle, invoke
//                    the judge; on success, write per-row scores + winner,
//                    flip status to judged; on failure, status=failed.
//   cancel(runId)  — abort the in-flight controller, flip pending rows
//                    to cancelled, flip run status to cancelled.
//
// Budget gating: rejects new runs when the company is paused (pause_reason
// = "budget"). Per-call enforcement happens at the proxy.
//
// Cost capture: each candidate call carries x-nessie-company so the
// proxy's cost_events row is written automatically. We additionally
// denormalize cost_cents / tokens onto each arena_results row from the
// upstream OpenAI-shape usage block; latency_ms is captured here (no
// such column exists on cost_events).

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "@nessie/db";
import { arenaResults, arenaRuns, companies } from "@nessie/db";
import {
  DEFAULT_ARENA_JUDGE_MODEL,
  SUPPORTED_ARENA_MODELS,
  type SupportedArenaModel,
} from "@nessie/shared";
import { logActivity } from "./activity-log.js";
import { publishLiveEvent } from "./live-events.js";
import { scoreCandidates } from "./arena-judge.js";

const PROXY_BASE = process.env.PAPERCLIP_PROXY_URL?.trim() || "http://127.0.0.1:7777";
const PER_CANDIDATE_TIMEOUT_MS = 60_000;
const SUPPORTED_MODEL_SET: ReadonlySet<string> = new Set(SUPPORTED_ARENA_MODELS);

export type ArenaRunStatus = "running" | "judged" | "cancelled" | "failed";
export type ArenaResultStatus = "pending" | "completed" | "failed" | "cancelled";

interface RuntimeState {
  controller: AbortController;
  /** Resolved once the run reaches a terminal state (used by tests). */
  donePromise: Promise<void>;
}

const runtime = new Map<string, RuntimeState>();

export interface CreateInput {
  companyId: string;
  taskType: string;
  prompt: string;
  candidateModels: string[];
  judgeModel?: string;
  requestedByAgentId?: string | null;
  requestedByUserId?: string | null;
}

export interface ArenaService {
  create(input: CreateInput): Promise<{ ok: true; runId: string } | { ok: false; error: string }>;
  start(runId: string): Promise<void>;
  cancel(runId: string, opts?: { actorType?: "user" | "agent" | "system"; actorId?: string }): Promise<{ ok: boolean; status: ArenaRunStatus }>;
  get(runId: string, companyId: string): Promise<ArenaRunWithResults | null>;
  list(companyId: string, opts?: { taskType?: string; status?: ArenaRunStatus; limit?: number }): Promise<ArenaRunWithResults[]>;
  leaderboard(companyId: string, opts?: { taskType?: string }): Promise<LeaderboardEntry[]>;
}

export interface ArenaRunWithResults {
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
  results: ArenaResultRow[];
}

export interface ArenaResultRow {
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

export interface LeaderboardEntry {
  model: string;
  wins: number;
  runsScored: number;
  avgScore: number;
  totalCostCents: number;
}

export interface ArenaServiceOptions {
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Override the judge call (tests). */
  judgeImpl?: typeof scoreCandidates;
}

function tierForModel(modelAlias: string): "T1" | "T2" | "T3" {
  if (modelAlias.startsWith("t1:")) return "T1";
  if (modelAlias.startsWith("t3:")) return "T3";
  return "T2";
}

function nowIso(): string {
  return new Date().toISOString();
}

function asIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function toRunWithResults(run: typeof arenaRuns.$inferSelect, results: typeof arenaResults.$inferSelect[]): ArenaRunWithResults {
  return {
    id: run.id,
    companyId: run.companyId,
    taskType: run.taskType,
    prompt: run.prompt,
    candidateModels: run.candidateModels,
    judgeModel: run.judgeModel,
    status: run.status as ArenaRunStatus,
    winnerModel: run.winnerModel,
    judgeRubric: run.judgeRubric ?? null,
    judgeNotes: run.judgeNotes,
    judgeError: run.judgeError,
    totalCostCents: run.totalCostCents,
    requestedByAgentId: run.requestedByAgentId,
    requestedByUserId: run.requestedByUserId,
    startedAt: asIso(run.startedAt),
    completedAt: asIso(run.completedAt),
    cancelledAt: asIso(run.cancelledAt),
    createdAt: asIso(run.createdAt) ?? new Date().toISOString(),
    updatedAt: asIso(run.updatedAt) ?? new Date().toISOString(),
    results: results.map((r) => ({
      id: r.id,
      arenaRunId: r.arenaRunId,
      model: r.model,
      status: r.status as ArenaResultStatus,
      outputText: r.outputText,
      latencyMs: r.latencyMs,
      inputTokens: r.inputTokens,
      cachedInputTokens: r.cachedInputTokens,
      outputTokens: r.outputTokens,
      costCents: r.costCents,
      score: r.score,
      judgeReasoning: r.judgeReasoning,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      startedAt: asIso(r.startedAt),
      completedAt: asIso(r.completedAt),
      createdAt: asIso(r.createdAt) ?? new Date().toISOString(),
    })),
  };
}

interface CandidateCallResult {
  model: string;
  status: ArenaResultStatus;
  outputText: string | null;
  latencyMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  costCents: number;
  errorCode: string | null;
  errorMessage: string | null;
}

interface OpenAiShape {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

async function callCandidateModel(opts: {
  companyId: string;
  model: string;
  prompt: string;
  signal: AbortSignal;
  fetchImpl: typeof fetch;
}): Promise<CandidateCallResult> {
  const startedAt = Date.now();
  let response: Response;
  try {
    response = await opts.fetchImpl(`${PROXY_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nessie-tier": tierForModel(opts.model),
        "x-nessie-company": opts.companyId,
        "x-nessie-agent": "nessie-arena-candidate",
        "x-nessie-operator-triggered": "true",
      },
      body: JSON.stringify({
        model: opts.model,
        messages: [{ role: "user", content: opts.prompt }],
        stream: false,
      }),
      signal: AbortSignal.any([opts.signal, AbortSignal.timeout(PER_CANDIDATE_TIMEOUT_MS)]),
    });
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const aborted = err instanceof Error && err.name === "AbortError";
    return {
      model: opts.model,
      status: aborted && opts.signal.aborted ? "cancelled" : "failed",
      outputText: null,
      latencyMs,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      errorCode: aborted ? (opts.signal.aborted ? "cancelled" : "timeout") : "transport_error",
      errorMessage: err instanceof Error ? err.message : "fetch failed",
    };
  }
  const latencyMs = Date.now() - startedAt;
  const raw = await response.text();
  if (!response.ok) {
    return {
      model: opts.model,
      status: "failed",
      outputText: null,
      latencyMs,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      errorCode: `http_${response.status}`,
      errorMessage: raw.slice(0, 500),
    };
  }
  let parsed: OpenAiShape;
  try {
    parsed = JSON.parse(raw) as OpenAiShape;
  } catch {
    return {
      model: opts.model,
      status: "failed",
      outputText: null,
      latencyMs,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      costCents: 0,
      errorCode: "parse_error",
      errorMessage: "upstream returned non-JSON",
    };
  }
  const outputText = parsed.choices?.[0]?.message?.content ?? "";
  if (!outputText) {
    return {
      model: opts.model,
      status: "failed",
      outputText: null,
      latencyMs,
      inputTokens: parsed.usage?.prompt_tokens ?? 0,
      cachedInputTokens: parsed.usage?.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens: parsed.usage?.completion_tokens ?? 0,
      costCents: 0,
      errorCode: "empty_response",
      errorMessage: "upstream returned no content",
    };
  }
  const inputTokens = parsed.usage?.prompt_tokens ?? 0;
  const cachedInputTokens = parsed.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const outputTokens = parsed.usage?.completion_tokens ?? 0;
  // Best-effort cost denormalisation. The proxy is the source of truth in
  // cost_events; this is just so the operator sees a number in the card
  // immediately without a join. Roughly 1 cent per 1k tokens for T2;
  // accurate enough for ranking visualisation.
  const tierMultiplier = tierForModel(opts.model) === "T3" ? 0.2 : 1;
  const costCents = Math.ceil(((inputTokens + outputTokens) / 1000) * tierMultiplier);
  return {
    model: opts.model,
    status: "completed",
    outputText,
    latencyMs,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    costCents,
    errorCode: null,
    errorMessage: null,
  };
}

export function arenaService(db: Db, options: ArenaServiceOptions = {}): ArenaService {
  const fetchImpl = options.fetchImpl ?? fetch;
  const judgeImpl = options.judgeImpl ?? scoreCandidates;

  async function loadRun(runId: string, companyId?: string): Promise<ArenaRunWithResults | null> {
    const conds = companyId
      ? and(eq(arenaRuns.id, runId), eq(arenaRuns.companyId, companyId))
      : eq(arenaRuns.id, runId);
    const rows = await db.select().from(arenaRuns).where(conds).limit(1);
    if (rows.length === 0) return null;
    const resultRows = await db
      .select()
      .from(arenaResults)
      .where(eq(arenaResults.arenaRunId, runId))
      .orderBy(arenaResults.model);
    return toRunWithResults(rows[0], resultRows);
  }

  const service: ArenaService = {
    async create(input) {
      const taskType = input.taskType.trim();
      const prompt = input.prompt.trim();
      if (!taskType) return { ok: false, error: "taskType is required" };
      if (!prompt) return { ok: false, error: "prompt is required" };

      const dedupedModels = Array.from(new Set(input.candidateModels));
      if (dedupedModels.length < 2) return { ok: false, error: "at least 2 candidate models required" };
      if (dedupedModels.length > 8) return { ok: false, error: "at most 8 candidate models" };
      for (const m of dedupedModels) {
        if (!SUPPORTED_MODEL_SET.has(m)) return { ok: false, error: `model "${m}" is not in the supported set` };
      }
      const judgeModel = input.judgeModel ?? DEFAULT_ARENA_JUDGE_MODEL;
      if (!SUPPORTED_MODEL_SET.has(judgeModel) && judgeModel !== DEFAULT_ARENA_JUDGE_MODEL) {
        return { ok: false, error: `judge model "${judgeModel}" is not supported` };
      }

      const company = await db
        .select({ status: companies.status, pauseReason: companies.pauseReason, name: companies.name })
        .from(companies)
        .where(eq(companies.id, input.companyId))
        .limit(1);
      if (!company[0]) return { ok: false, error: "company not found" };
      if (company[0].status === "paused" && company[0].pauseReason === "budget") {
        return { ok: false, error: "company is paused: budget hard-stop is exceeded" };
      }

      const runId = randomUUID();
      await db
        .insert(arenaRuns)
        .values({
          id: runId,
          companyId: input.companyId,
          taskType,
          prompt,
          candidateModels: dedupedModels,
          judgeModel,
          requestedByAgentId: input.requestedByAgentId ?? null,
          requestedByUserId: input.requestedByUserId ?? null,
          status: "running",
        });
      await db.insert(arenaResults).values(
        dedupedModels.map((model) => ({
          arenaRunId: runId,
          model,
          status: "pending" as const,
        })),
      );

      await logActivity(db, {
        companyId: input.companyId,
        actorType: input.requestedByUserId ? "user" : input.requestedByAgentId ? "agent" : "system",
        actorId: input.requestedByUserId ?? input.requestedByAgentId ?? "nessie-arena",
        action: "arena.run_started",
        entityType: "arena_run",
        entityId: runId,
        details: { taskType, candidateModels: dedupedModels, judgeModel },
      });
      publishLiveEvent({
        companyId: input.companyId,
        type: "arena.run.started",
        payload: { runId, taskType, candidateModels: dedupedModels, judgeModel },
      });

      void service.start(runId);
      return { ok: true, runId };
    },

    async start(runId) {
      const existing = runtime.get(runId);
      if (existing) return existing.donePromise;
      const controller = new AbortController();
      const donePromise = (async () => {
        const initial = await loadRun(runId);
        if (!initial) return;
        if (initial.status !== "running") return;
        await db
          .update(arenaRuns)
          .set({ startedAt: new Date(), updatedAt: new Date() })
          .where(eq(arenaRuns.id, runId));

        const settled = await Promise.all(
          initial.candidateModels.map((model) =>
            callCandidateModel({
              companyId: initial.companyId,
              model,
              prompt: initial.prompt,
              signal: controller.signal,
              fetchImpl,
            }).then(async (result) => {
              await db
                .update(arenaResults)
                .set({
                  status: result.status,
                  outputText: result.outputText,
                  latencyMs: result.latencyMs,
                  inputTokens: result.inputTokens,
                  cachedInputTokens: result.cachedInputTokens,
                  outputTokens: result.outputTokens,
                  costCents: result.costCents,
                  errorCode: result.errorCode,
                  errorMessage: result.errorMessage,
                  startedAt: new Date(Date.now() - result.latencyMs),
                  completedAt: new Date(),
                })
                .where(and(eq(arenaResults.arenaRunId, runId), eq(arenaResults.model, model)));
              publishLiveEvent({
                companyId: initial.companyId,
                type: "arena.run.result_landed",
                payload: { runId, model, status: result.status, costCents: result.costCents, latencyMs: result.latencyMs },
              });
              return result;
            }),
          ),
        );

        // If the operator cancelled mid-flight, cancel() has already
        // moved the run to terminal — bail before judging.
        const refreshed = await loadRun(runId);
        if (!refreshed || refreshed.status !== "running") return;

        const completed = settled.filter((r) => r.status === "completed");
        const totalCandidateCostCents = settled.reduce((acc, r) => acc + r.costCents, 0);

        if (completed.length === 0) {
          await db
            .update(arenaRuns)
            .set({
              status: "failed",
              judgeError: "all candidates failed",
              completedAt: new Date(),
              totalCostCents: totalCandidateCostCents,
              updatedAt: new Date(),
            })
            .where(eq(arenaRuns.id, runId));
          await logActivity(db, {
            companyId: initial.companyId,
            actorType: "system",
            actorId: "nessie-arena",
            action: "arena.run_failed",
            entityType: "arena_run",
            entityId: runId,
            details: { reason: "all_candidates_failed" },
          });
          publishLiveEvent({
            companyId: initial.companyId,
            type: "arena.run.failed",
            payload: { runId, reason: "all_candidates_failed" },
          });
          return;
        }

        const judge = await judgeImpl({
          companyId: initial.companyId,
          judgeModel: initial.judgeModel,
          taskType: initial.taskType,
          prompt: initial.prompt,
          candidates: completed.map((r) => ({ model: r.model, outputText: r.outputText ?? "" })),
          fetchImpl,
        });

        if (!judge.ok) {
          await db
            .update(arenaRuns)
            .set({
              status: "failed",
              judgeError: judge.error,
              completedAt: new Date(),
              totalCostCents: totalCandidateCostCents + judge.judgeCostCents,
              updatedAt: new Date(),
            })
            .where(eq(arenaRuns.id, runId));
          await logActivity(db, {
            companyId: initial.companyId,
            actorType: "system",
            actorId: "nessie-arena",
            action: "arena.run_failed",
            entityType: "arena_run",
            entityId: runId,
            details: { reason: "judge_failed", error: judge.error },
          });
          publishLiveEvent({
            companyId: initial.companyId,
            type: "arena.run.failed",
            payload: { runId, reason: "judge_failed", error: judge.error },
          });
          return;
        }

        await Promise.all(
          judge.rankings.map((r) =>
            db
              .update(arenaResults)
              .set({ score: r.score, judgeReasoning: r.reasoning })
              .where(and(eq(arenaResults.arenaRunId, runId), eq(arenaResults.model, r.model))),
          ),
        );
        await db
          .update(arenaRuns)
          .set({
            status: "judged",
            winnerModel: judge.winnerModel,
            judgeRubric: judge.rubric,
            judgeNotes: judge.notes,
            judgeError: null,
            totalCostCents: totalCandidateCostCents + judge.judgeCostCents,
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(arenaRuns.id, runId));
        await logActivity(db, {
          companyId: initial.companyId,
          actorType: "system",
          actorId: "nessie-arena",
          action: "arena.run_judged",
          entityType: "arena_run",
          entityId: runId,
          details: { winnerModel: judge.winnerModel, taskType: initial.taskType },
        });
        publishLiveEvent({
          companyId: initial.companyId,
          type: "arena.run.judged",
          payload: {
            runId,
            winnerModel: judge.winnerModel,
            rankings: judge.rankings,
            notes: judge.notes,
          },
        });
      })().catch(async (err) => {
        // Defensive — Promise.all caught everything we expect, but if a
        // db write throws we still need to mark the run failed.
        const message = err instanceof Error ? err.message : String(err);
        await db
          .update(arenaRuns)
          .set({ status: "failed", judgeError: message, completedAt: new Date(), updatedAt: new Date() })
          .where(eq(arenaRuns.id, runId));
        const refreshed = await loadRun(runId);
        if (refreshed) {
          publishLiveEvent({
            companyId: refreshed.companyId,
            type: "arena.run.failed",
            payload: { runId, reason: "internal_error", error: message },
          });
        }
      }).finally(() => {
        runtime.delete(runId);
      });
      runtime.set(runId, { controller, donePromise });
      return donePromise;
    },

    async cancel(runId, opts) {
      const run = await db
        .select({ companyId: arenaRuns.companyId, status: arenaRuns.status })
        .from(arenaRuns)
        .where(eq(arenaRuns.id, runId))
        .limit(1);
      if (!run[0]) return { ok: false, status: "failed" };
      if (run[0].status !== "running") return { ok: false, status: run[0].status as ArenaRunStatus };
      const rt = runtime.get(runId);
      rt?.controller.abort();
      await db
        .update(arenaResults)
        .set({ status: "cancelled", completedAt: new Date() })
        .where(and(eq(arenaResults.arenaRunId, runId), eq(arenaResults.status, "pending")));
      await db
        .update(arenaRuns)
        .set({ status: "cancelled", cancelledAt: new Date(), completedAt: new Date(), updatedAt: new Date() })
        .where(eq(arenaRuns.id, runId));
      await logActivity(db, {
        companyId: run[0].companyId,
        actorType: opts?.actorType ?? "user",
        actorId: opts?.actorId ?? "operator",
        action: "arena.run_cancelled",
        entityType: "arena_run",
        entityId: runId,
        details: null,
      });
      publishLiveEvent({
        companyId: run[0].companyId,
        type: "arena.run.cancelled",
        payload: { runId },
      });
      return { ok: true, status: "cancelled" };
    },

    async get(runId, companyId) {
      return loadRun(runId, companyId);
    },

    async list(companyId, opts) {
      const conds = [eq(arenaRuns.companyId, companyId)];
      if (opts?.taskType) conds.push(eq(arenaRuns.taskType, opts.taskType));
      if (opts?.status) conds.push(eq(arenaRuns.status, opts.status));
      const runs = await db
        .select()
        .from(arenaRuns)
        .where(and(...conds))
        .orderBy(desc(arenaRuns.createdAt))
        .limit(opts?.limit ?? 50);
      if (runs.length === 0) return [];
      const ids = runs.map((r) => r.id);
      const allResults = await db
        .select()
        .from(arenaResults)
        .where(inArray(arenaResults.arenaRunId, ids));
      const byRun = new Map<string, typeof arenaResults.$inferSelect[]>();
      for (const r of allResults) {
        const arr = byRun.get(r.arenaRunId) ?? [];
        arr.push(r);
        byRun.set(r.arenaRunId, arr);
      }
      return runs.map((run) => toRunWithResults(run, byRun.get(run.id) ?? []));
    },

    async leaderboard(companyId, opts) {
      const conds = [eq(arenaRuns.companyId, companyId), eq(arenaRuns.status, "judged")];
      if (opts?.taskType) conds.push(eq(arenaRuns.taskType, opts.taskType));
      const runs = await db
        .select({
          id: arenaRuns.id,
          winnerModel: arenaRuns.winnerModel,
          totalCostCents: arenaRuns.totalCostCents,
        })
        .from(arenaRuns)
        .where(and(...conds));
      const ids = runs.map((r) => r.id);
      if (ids.length === 0) return [];
      const scoreRows = await db
        .select({
          model: arenaResults.model,
          score: arenaResults.score,
          arenaRunId: arenaResults.arenaRunId,
        })
        .from(arenaResults)
        .where(and(inArray(arenaResults.arenaRunId, ids), sql`${arenaResults.score} is not null`));

      const stats = new Map<string, { wins: number; scoreSum: number; runsScored: number; totalCostCents: number }>();
      for (const row of runs) {
        if (!row.winnerModel) continue;
        const s = stats.get(row.winnerModel) ?? { wins: 0, scoreSum: 0, runsScored: 0, totalCostCents: 0 };
        s.wins += 1;
        s.totalCostCents += row.totalCostCents;
        stats.set(row.winnerModel, s);
      }
      for (const row of scoreRows) {
        if (row.score == null) continue;
        const s = stats.get(row.model) ?? { wins: 0, scoreSum: 0, runsScored: 0, totalCostCents: 0 };
        s.scoreSum += row.score;
        s.runsScored += 1;
        stats.set(row.model, s);
      }
      const entries: LeaderboardEntry[] = [];
      for (const [model, s] of stats.entries()) {
        entries.push({
          model,
          wins: s.wins,
          runsScored: s.runsScored,
          avgScore: s.runsScored > 0 ? Math.round(s.scoreSum / s.runsScored) : 0,
          totalCostCents: s.totalCostCents,
        });
      }
      entries.sort((a, b) => b.wins - a.wins || b.avgScore - a.avgScore);
      return entries;
    },
  };
  return service;
}

export { runtime as __arenaRuntimeForTests };
