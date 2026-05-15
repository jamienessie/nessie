// Plan §next-up. Replay Lab service.
//
// Re-runs a past heartbeat run (or an ad-hoc prompt) through the
// cost-tier proxy with operator-specified overrides (model,
// prompt, systemPrompt). Stores the result side-by-side with the
// original so the operator can answer "would this have been better
// with model X / prompt Y / system prompt Z?".

import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { agents, heartbeatRuns, replayRuns } from "@nessie/db";
import { logActivity } from "./activity-log.js";

const PROXY_BASE = process.env.PAPERCLIP_PROXY_URL?.trim() || "http://127.0.0.1:7777";

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

function toReplay(row: typeof replayRuns.$inferSelect): ReplayRun {
  return {
    id: row.id,
    companyId: row.companyId,
    originalRunId: row.originalRunId,
    overrideModel: row.overrideModel,
    overridePrompt: row.overridePrompt,
    overrideSystemPrompt: row.overrideSystemPrompt,
    status: row.status as ReplayStatus,
    outputText: row.outputText,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costCents: row.costCents,
    latencyMs: row.latencyMs,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    requestedByUserId: row.requestedByUserId,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

function tierForModel(model: string): "T1" | "T2" | "T3" {
  if (model.startsWith("t1:")) return "T1";
  if (model.startsWith("t3:")) return "T3";
  return "T2";
}

export interface ReplayInput {
  companyId: string;
  originalRunId?: string | null;
  overrideModel: string;
  overridePrompt: string;
  overrideSystemPrompt?: string | null;
  requestedByUserId?: string | null;
  /** Override fetch (tests). */
  fetchImpl?: typeof fetch;
}

export interface ReplaySource {
  originalRunId: string;
  model: string | null;
  systemPrompt: string | null;
  promptHint: string;
  promptHintFrom: "contextSnapshot" | "stdout_excerpt" | null;
}

export interface ReplayLabService {
  replay(input: ReplayInput): Promise<ReplayRun>;
  list(companyId: string, opts?: { limit?: number }): Promise<ReplayRun[]>;
  get(replayId: string, companyId: string): Promise<{ replay: ReplayRun; original: { id: string; resultJson: unknown } | null } | null>;
  /** Best-effort extract of replay inputs from a past heartbeat run so the
   *  Cockpit can pre-fill the form. Returns null if the run isn't in the
   *  caller's company. */
  source(originalRunId: string, companyId: string): Promise<ReplaySource | null>;
}

interface OpenAiShape {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export function replayLabService(db: Db): ReplayLabService {
  return {
    async replay(input) {
      const fetchImpl = input.fetchImpl ?? fetch;
      const prompt = input.overridePrompt.trim();
      if (!prompt) throw new Error("overridePrompt required");
      if (!input.overrideModel.trim()) throw new Error("overrideModel required");

      const [created] = await db
        .insert(replayRuns)
        .values({
          companyId: input.companyId,
          originalRunId: input.originalRunId ?? null,
          overrideModel: input.overrideModel,
          overridePrompt: prompt,
          overrideSystemPrompt: input.overrideSystemPrompt ?? null,
          status: "running",
          requestedByUserId: input.requestedByUserId ?? null,
        })
        .returning();

      const startedAt = Date.now();
      const messages: Array<{ role: "system" | "user"; content: string }> = [];
      if (input.overrideSystemPrompt && input.overrideSystemPrompt.trim()) {
        messages.push({ role: "system", content: input.overrideSystemPrompt });
      }
      messages.push({ role: "user", content: prompt });

      let response: Response;
      try {
        response = await fetchImpl(`${PROXY_BASE}/v1/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-nessie-tier": tierForModel(input.overrideModel),
            "x-nessie-company": input.companyId,
            "x-nessie-agent": "nessie-replay-lab",
            "x-nessie-operator-triggered": "true",
          },
          body: JSON.stringify({
            model: input.overrideModel,
            messages,
            stream: false,
          }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch (err) {
        const latencyMs = Date.now() - startedAt;
        const message = err instanceof Error ? err.message : "fetch failed";
        const [updated] = await db
          .update(replayRuns)
          .set({
            status: "failed",
            errorCode: "transport_error",
            errorMessage: message,
            latencyMs,
            completedAt: new Date(),
          })
          .where(eq(replayRuns.id, created.id))
          .returning();
        return toReplay(updated);
      }

      const latencyMs = Date.now() - startedAt;
      const raw = await response.text();
      if (!response.ok) {
        const [updated] = await db
          .update(replayRuns)
          .set({
            status: "failed",
            errorCode: `http_${response.status}`,
            errorMessage: raw.slice(0, 500),
            latencyMs,
            completedAt: new Date(),
          })
          .where(eq(replayRuns.id, created.id))
          .returning();
        return toReplay(updated);
      }
      let parsed: OpenAiShape;
      try {
        parsed = JSON.parse(raw) as OpenAiShape;
      } catch {
        const [updated] = await db
          .update(replayRuns)
          .set({
            status: "failed",
            errorCode: "parse_error",
            errorMessage: "upstream returned non-JSON",
            latencyMs,
            completedAt: new Date(),
          })
          .where(eq(replayRuns.id, created.id))
          .returning();
        return toReplay(updated);
      }
      const output = parsed.choices?.[0]?.message?.content ?? "";
      const inputTokens = parsed.usage?.prompt_tokens ?? 0;
      const outputTokens = parsed.usage?.completion_tokens ?? 0;
      const tierMultiplier = tierForModel(input.overrideModel) === "T3" ? 0.2 : 1;
      const costCents = Math.ceil(((inputTokens + outputTokens) / 1000) * tierMultiplier);
      const [updated] = await db
        .update(replayRuns)
        .set({
          status: "completed",
          outputText: output,
          inputTokens,
          outputTokens,
          costCents,
          latencyMs,
          completedAt: new Date(),
        })
        .where(eq(replayRuns.id, created.id))
        .returning();
      await logActivity(db, {
        companyId: input.companyId,
        actorType: input.requestedByUserId ? "user" : "system",
        actorId: input.requestedByUserId ?? "nessie-replay",
        action: "replay.completed",
        entityType: "replay_run",
        entityId: created.id,
        details: { overrideModel: input.overrideModel, costCents, latencyMs },
      });
      return toReplay(updated);
    },

    async list(companyId, opts) {
      const rows = await db
        .select()
        .from(replayRuns)
        .where(eq(replayRuns.companyId, companyId))
        .orderBy(desc(replayRuns.createdAt))
        .limit(opts?.limit ?? 50);
      return rows.map(toReplay);
    },

    async source(originalRunId, companyId) {
      const rows = await db
        .select({
          id: heartbeatRuns.id,
          companyId: heartbeatRuns.companyId,
          contextSnapshot: heartbeatRuns.contextSnapshot,
          stdoutExcerpt: heartbeatRuns.stdoutExcerpt,
          adapterConfig: agents.adapterConfig,
        })
        .from(heartbeatRuns)
        .leftJoin(agents, eq(agents.id, heartbeatRuns.agentId))
        .where(eq(heartbeatRuns.id, originalRunId))
        .limit(1);
      const row = rows[0];
      if (!row || row.companyId !== companyId) return null;
      const adapterConfig = (row.adapterConfig ?? {}) as Record<string, unknown>;
      const model = typeof adapterConfig.model === "string" ? adapterConfig.model : null;
      const systemPrompt = typeof adapterConfig.systemPrompt === "string"
        ? adapterConfig.systemPrompt
        : null;
      let promptHint = "";
      let promptHintFrom: ReplaySource["promptHintFrom"] = null;
      const ctx = row.contextSnapshot as Record<string, unknown> | null;
      if (ctx && typeof ctx.prompt === "string" && ctx.prompt.trim()) {
        promptHint = ctx.prompt;
        promptHintFrom = "contextSnapshot";
      } else if (typeof row.stdoutExcerpt === "string" && row.stdoutExcerpt.trim()) {
        promptHint = row.stdoutExcerpt;
        promptHintFrom = "stdout_excerpt";
      }
      return {
        originalRunId: row.id,
        model,
        systemPrompt,
        promptHint,
        promptHintFrom,
      };
    },

    async get(replayId, companyId) {
      const rows = await db
        .select()
        .from(replayRuns)
        .where(and(eq(replayRuns.id, replayId), eq(replayRuns.companyId, companyId)))
        .limit(1);
      if (!rows[0]) return null;
      const replay = toReplay(rows[0]);
      let original: { id: string; resultJson: unknown } | null = null;
      if (replay.originalRunId) {
        const orig = await db
          .select({ id: heartbeatRuns.id, resultJson: heartbeatRuns.resultJson })
          .from(heartbeatRuns)
          .where(eq(heartbeatRuns.id, replay.originalRunId))
          .limit(1);
        if (orig[0]) original = orig[0];
      }
      return { replay, original };
    },
  };
}
