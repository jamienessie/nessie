import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@nessie/db";
import {
  agents,
  costEvents,
  heartbeatRuns,
  inboxItems,
  janitorOutages,
  janitorReports,
} from "@nessie/db";
import type {
  AdapterEnvironmentTestResult,
  AdapterModel,
  ServerAdapterModule,
} from "@nessie/adapter-utils";
import { logActivity } from "./activity-log.js";
import { publishLiveEvent } from "./live-events.js";
import { buildAgentDisplayLabel } from "./agents.js";
import {
  getServerAdapter,
  listAdapterModels,
} from "../adapters/registry.js";
import { logger } from "../middleware/logger.js";
import { detectAdapterOutages, escalateOutages } from "./plug-in-janitor-outage.js";
import type { JanitorReportSwap, JanitorReportPause } from "@nessie/db";

// Plug-In Janitor — Hank Brennan, Engineering, T3.
//
// Hank scans the agent roster, detects broken or out-of-quota bindings,
// and either swaps the agent onto a working same-tier replacement or
// pauses the agent with an inbox notification. Whole-adapter outages
// (>=80% of attempted models fail with the same error) escalate to a
// code-capable engineer agent via an issue with a drafted plan.
//
// Tier-safety is hard: same-tier swaps only. A T3 agent never gets bumped
// to a paid model automatically — it gets paused, surfaced to the operator.

export const QUOTA_USED_PERCENT_THRESHOLD = 95;
export const SWAP_COOLDOWN_MS = 30 * 60 * 1000; // 30 min anti-flap
export const RECENT_RUN_FAILURE_WINDOW = 3;
export const AUTO_ON_ERROR_DEDUPE_WINDOW_MS = 60 * 1000;

export const BROKEN_BINDING_ERROR_CODES: ReadonlySet<string> = new Set([
  "quota_exceeded",
  "rate_limit_exceeded",
  "rate_limited",
  "auth_failed",
  "unauthorized",
  "model_not_found",
  "gemini_non_free_model",
  "insufficient_quota",
  "gemini_api_key_missing",
]);

export type DetectionReasonCode =
  | "health_probe_failed"
  | "quota_exhausted"
  | "model_deprecated"
  | "recent_failure_pattern";

export type DetectionReason = {
  code: DetectionReasonCode;
  detail: string;
  /** When the detection signal includes a per-model error, what we'll record on outage grouping. */
  errorCode?: string;
  errorMessage?: string;
};

export type AgentBinding = {
  adapterType: string;
  model: string;
};

export type AgentRow = typeof agents.$inferSelect;

export type SweepScope = { kind: "all" } | { kind: "agent"; agentId: string };

export type SweepTrigger = "manual" | "scheduled" | "auto_on_error";

export type SweepInput = {
  companyId: string;
  scope: SweepScope;
  triggeredBy: SweepTrigger;
  triggeredByUserId?: string | null;
};

export type SweepResult = {
  reportId: string;
  scanned: number;
  healthy: number;
  swapped: number;
  paused: number;
  skippedCooldown: number;
  outagesDetected: number;
};

type ProbeResult = {
  agentId: string;
  agentLabel: string;
  binding: AgentBinding;
  outcome:
    | { kind: "healthy" }
    | { kind: "needs_swap"; reasons: DetectionReason[] }
    | { kind: "skipped_cooldown" };
};

type ModelProbeResult = {
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
};

function readBindingFromAgent(row: AgentRow): AgentBinding {
  const config = (row.adapterConfig ?? {}) as Record<string, unknown>;
  const model = typeof config.model === "string" ? config.model : "";
  return { adapterType: row.adapterType, model };
}

function metadataObject(row: AgentRow): Record<string, unknown> {
  return (row.metadata ?? {}) as Record<string, unknown>;
}

function readJanitorLastSwapAt(row: AgentRow): Date | null {
  const meta = metadataObject(row);
  const value = meta.janitorLastSwapAt;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isWithinCooldown(lastSwapAt: Date | null, now: number): boolean {
  if (!lastSwapAt) return false;
  return now - lastSwapAt.getTime() < SWAP_COOLDOWN_MS;
}

async function probeModelEnvironment(
  adapter: ServerAdapterModule,
  config: Record<string, unknown>,
  companyId: string,
): Promise<ModelProbeResult> {
  try {
    const result: AdapterEnvironmentTestResult = await adapter.testEnvironment({
      companyId,
      adapterType: adapter.type,
      config,
    });
    if (result.status === "fail") {
      const firstError = result.checks.find((c) => c.level === "error");
      return {
        ok: false,
        errorCode: firstError?.code,
        errorMessage: firstError?.message,
      };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, errorCode: "test_environment_threw", errorMessage: message };
  }
}

async function listModelsSafe(adapterType: string): Promise<AdapterModel[]> {
  try {
    return await listAdapterModels(adapterType);
  } catch (err) {
    logger.warn({ adapterType, err }, "janitor: listAdapterModels threw");
    return [];
  }
}

// Tier-grouped fallback adapter list. T3-only includes free-filtered Gemini
// + free OpenRouter; T2 includes paid OpenAI-compatible + paid OpenRouter;
// T1 includes Claude/Codex local. Used when same-adapter swap finds no
// working candidate. Cross-tier is never attempted.
const TIER_ADAPTER_FALLBACKS: Record<string, string[]> = {
  T1: ["claude_local", "codex_local"],
  T2: ["openai_compatible", "openrouter_compatible"],
  T3: ["gemini_compatible", "openrouter_compatible"],
};

function adaptersForTier(tier: string | null | undefined): string[] {
  if (!tier) return [];
  return TIER_ADAPTER_FALLBACKS[tier] ?? [];
}

async function detectBindingHealth(
  db: Db,
  row: AgentRow,
  companyId: string,
): Promise<DetectionReason[]> {
  const reasons: DetectionReason[] = [];
  const binding = readBindingFromAgent(row);
  const adapter = getServerAdapter(binding.adapterType);
  const config = { ...((row.adapterConfig ?? {}) as Record<string, unknown>) };

  const probe = await probeModelEnvironment(adapter, config, companyId);
  if (!probe.ok) {
    reasons.push({
      code: "health_probe_failed",
      detail: probe.errorMessage ?? "Health probe failed",
      errorCode: probe.errorCode,
      errorMessage: probe.errorMessage,
    });
  }

  if (adapter.getQuotaWindows) {
    try {
      const quota = await adapter.getQuotaWindows();
      if (quota.ok) {
        const exhausted = quota.windows.find(
          (w) => typeof w.usedPercent === "number" && (w.usedPercent ?? 0) >= QUOTA_USED_PERCENT_THRESHOLD,
        );
        if (exhausted) {
          reasons.push({
            code: "quota_exhausted",
            detail: `${exhausted.label} at ${exhausted.usedPercent}% used`,
            errorCode: "quota_exceeded",
          });
        }
      }
    } catch (err) {
      logger.debug({ adapterType: binding.adapterType, err }, "janitor: getQuotaWindows threw");
    }
  }

  if (adapter.listModels && binding.model) {
    const models = await listModelsSafe(binding.adapterType);
    if (models.length > 0 && !models.some((m) => m.id === binding.model)) {
      reasons.push({
        code: "model_deprecated",
        detail: `Model ${binding.model} not in current ${binding.adapterType} catalog`,
        errorCode: "model_not_found",
      });
    }
  }

  const recentRuns = await db
    .select({ errorCode: heartbeatRuns.errorCode, status: heartbeatRuns.status })
    .from(heartbeatRuns)
    .where(and(eq(heartbeatRuns.companyId, companyId), eq(heartbeatRuns.agentId, row.id)))
    .orderBy(desc(heartbeatRuns.createdAt))
    .limit(RECENT_RUN_FAILURE_WINDOW);
  if (
    recentRuns.length === RECENT_RUN_FAILURE_WINDOW
    && recentRuns.every((r) => r.errorCode && BROKEN_BINDING_ERROR_CODES.has(r.errorCode))
  ) {
    const lastCode = recentRuns[0]!.errorCode!;
    reasons.push({
      code: "recent_failure_pattern",
      detail: `Last ${RECENT_RUN_FAILURE_WINDOW} runs failed with broken-binding error codes (latest: ${lastCode})`,
      errorCode: lastCode,
    });
  }

  return reasons;
}

async function pickReplacementOnSameAdapter(
  binding: AgentBinding,
  config: Record<string, unknown>,
  companyId: string,
  blockedModels: ReadonlySet<string>,
): Promise<{ binding: AgentBinding; config: Record<string, unknown> } | null> {
  const adapter = getServerAdapter(binding.adapterType);
  const candidates = await listModelsSafe(binding.adapterType);
  for (const candidate of candidates) {
    if (candidate.id === binding.model) continue;
    if (blockedModels.has(candidate.id)) continue;
    const trialConfig = { ...config, model: candidate.id };
    const probe = await probeModelEnvironment(adapter, trialConfig, companyId);
    if (probe.ok) {
      return {
        binding: { adapterType: binding.adapterType, model: candidate.id },
        config: trialConfig,
      };
    }
  }
  return null;
}

async function pickReplacementInTier(
  currentBinding: AgentBinding,
  currentConfig: Record<string, unknown>,
  tier: string | null | undefined,
  companyId: string,
  closedAdapterTypes: ReadonlySet<string>,
): Promise<{ binding: AgentBinding; config: Record<string, unknown> } | null> {
  const fallbacks = adaptersForTier(tier);
  for (const adapterType of fallbacks) {
    if (adapterType === currentBinding.adapterType) continue;
    if (closedAdapterTypes.has(adapterType)) continue;
    const adapter = getServerAdapter(adapterType);
    const candidates = await listModelsSafe(adapterType);
    for (const candidate of candidates) {
      // Carry over adapter-agnostic config keys (apiKey, baseUrl) — agent
      // may have these. Most adapters tolerate extras and ignore unknown keys.
      const trialConfig = { ...currentConfig, model: candidate.id };
      const probe = await probeModelEnvironment(adapter, trialConfig, companyId);
      if (probe.ok) {
        return {
          binding: { adapterType, model: candidate.id },
          config: trialConfig,
        };
      }
    }
  }
  return null;
}

function summarizeReasons(reasons: DetectionReason[]): string {
  return reasons.map((r) => `${r.code}: ${r.detail}`).join("; ");
}

async function loadOpenOutageAdapterTypes(
  db: Db,
  companyId: string,
): Promise<Set<string>> {
  const rows = await db
    .select({ adapterType: janitorOutages.adapterType })
    .from(janitorOutages)
    .where(
      and(
        eq(janitorOutages.companyId, companyId),
        sql`${janitorOutages.status} in ('open', 'in_progress')`,
      ),
    );
  return new Set(rows.map((r) => r.adapterType));
}

async function findHankAgent(db: Db, companyId: string): Promise<AgentRow | null> {
  const [hank] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.roleTemplateKey, "eng.plug_in_janitor")))
    .limit(1);
  return hank ?? null;
}

async function loadAgentsForScope(
  db: Db,
  companyId: string,
  scope: SweepScope,
  hankId: string | null,
): Promise<AgentRow[]> {
  if (scope.kind === "agent") {
    const [row] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.id, scope.agentId)))
      .limit(1);
    if (!row) return [];
    if (hankId && row.id === hankId) return [];
    if (row.status === "terminated") return [];
    return [row];
  }
  const allAgents = await db
    .select()
    .from(agents)
    .where(eq(agents.companyId, companyId));
  return allAgents.filter((a) => a.id !== hankId && a.status !== "terminated");
}

async function writePauseInbox(
  db: Db,
  companyId: string,
  agent: AgentRow,
  binding: AgentBinding,
  reason: string,
  outageId: string | null,
): Promise<void> {
  const label = buildAgentDisplayLabel(agent).label;
  const kind = outageId ? "janitor_outage_opened" : "janitor_no_replacement";
  await db.insert(inboxItems).values({
    companyId,
    kind,
    bodyMarkdown: outageId
      ? `**${label}** is paused because adapter \`${binding.adapterType}\` is in an open outage. ${reason}`
      : `**${label}** has been paused — no working ${agent.tier ?? "(unknown tier)"} replacement for \`${binding.adapterType}:${binding.model}\`. ${reason}`,
    refs: [
      { kind: "agent", ref: agent.id, summary: label },
      ...(outageId ? [{ kind: "janitor_outage", ref: outageId }] : []),
    ],
  });
}

async function applySwap(
  db: Db,
  agent: AgentRow,
  newBinding: AgentBinding,
  newConfig: Record<string, unknown>,
  reasonText: string,
  now: Date,
): Promise<void> {
  const meta = metadataObject(agent);
  const priorBinding = readBindingFromAgent(agent);
  const updatedMeta: Record<string, unknown> = {
    ...meta,
    janitorLastSwapAt: now.toISOString(),
    janitorPriorBinding: priorBinding,
    janitorLastSwapReason: reasonText,
  };
  await db
    .update(agents)
    .set({
      adapterType: newBinding.adapterType,
      adapterConfig: newConfig,
      metadata: updatedMeta,
      updatedAt: now,
    })
    .where(eq(agents.id, agent.id));
}

async function applyPause(
  db: Db,
  agent: AgentRow,
  binding: AgentBinding,
  reasonText: string,
  now: Date,
): Promise<void> {
  const reason = `Plug-In Janitor: no working ${agent.tier ?? "(unknown tier)"} replacement for ${binding.adapterType}:${binding.model}. Reason: ${reasonText}`;
  await db
    .update(agents)
    .set({
      status: "paused",
      pauseReason: reason,
      pausedAt: now,
      updatedAt: now,
    })
    .where(eq(agents.id, agent.id));
}

function deterministicSummary(input: {
  scanned: number;
  healthy: number;
  swapped: number;
  paused: number;
  outagesDetected: number;
  swaps: JanitorReportSwap[];
  pauses: JanitorReportPause[];
}): string {
  const parts: string[] = [];
  parts.push(
    `Scanned ${input.scanned} agent${input.scanned === 1 ? "" : "s"}: ${input.healthy} healthy, ${input.swapped} swapped, ${input.paused} paused.`,
  );
  if (input.swaps.length > 0) {
    const head = input.swaps.slice(0, 3).map((s) => `${s.agentLabel} (${s.from.adapterType}:${s.from.model} → ${s.to.adapterType}:${s.to.model})`).join("; ");
    parts.push(`Swaps: ${head}${input.swaps.length > 3 ? ` and ${input.swaps.length - 3} more` : ""}.`);
  }
  if (input.pauses.length > 0) {
    const head = input.pauses.slice(0, 3).map((p) => p.agentLabel).join("; ");
    parts.push(`Paused: ${head}${input.pauses.length > 3 ? ` and ${input.pauses.length - 3} more` : ""}.`);
  }
  if (input.outagesDetected > 0) {
    parts.push(`Detected ${input.outagesDetected} adapter outage${input.outagesDetected === 1 ? "" : "s"} — escalated to engineering.`);
  }
  return parts.join(" ");
}

// Best-effort Gemini Flash call to write a one-paragraph operator summary.
// On any failure (Gemini outage, missing key, malformed response) returns
// null; caller falls back to the deterministic template. Never throws.
async function tryWriteHankProse(
  hank: AgentRow,
  prompt: string,
): Promise<string | null> {
  if (hank.adapterType !== "gemini_compatible") return null;
  const config = (hank.adapterConfig ?? {}) as Record<string, unknown>;
  const model = typeof config.model === "string" ? config.model : "";
  const apiKey =
    (typeof config.apiKey === "string" ? config.apiKey : null)
    ?? process.env.GEMINI_API_KEY
    ?? process.env.GOOGLE_API_KEY
    ?? null;
  const baseUrl = (typeof config.baseUrl === "string" ? config.baseUrl : null)
    ?? "https://generativelanguage.googleapis.com/v1beta";
  if (!model || !apiKey) return null;
  try {
    const url = `${baseUrl.replace(/\/+$/, "")}/openai/chat/completions`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 320,
        messages: [
          {
            role: "system",
            content:
              "You are Hank Brennan, Plug-In Janitor at a small AI company. Write exactly one short paragraph (3-5 sentences) in a calm, blue-collar voice describing the sweep result. No preamble, no bullets, no markdown. Do not invent facts.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    return typeof content === "string" && content.trim().length > 0 ? content.trim() : null;
  } catch (err) {
    logger.debug({ err }, "janitor: Hank LLM summary failed; falling back to deterministic");
    return null;
  }
}

export async function runJanitorSweep(db: Db, input: SweepInput): Promise<SweepResult> {
  const now = new Date();
  const hank = await findHankAgent(db, input.companyId);
  const hankId = hank?.id ?? null;

  const [reportInsert] = await db
    .insert(janitorReports)
    .values({
      companyId: input.companyId,
      triggeredBy: input.triggeredBy,
      triggeredByUserId: input.triggeredByUserId ?? null,
      scope: input.scope,
      startedAt: now,
      status: "running",
    })
    .returning();
  if (!reportInsert) throw new Error("Failed to create janitor report row");
  const reportId = reportInsert.id;

  const targets = await loadAgentsForScope(db, input.companyId, input.scope, hankId);
  const closedAdapters = await loadOpenOutageAdapterTypes(db, input.companyId);
  const probes: ProbeResult[] = [];
  const failedModelsByAdapter = new Map<string, Map<string, { errorCode: string; errorMessage: string }>>();

  for (const agent of targets) {
    const binding = readBindingFromAgent(agent);
    const label = buildAgentDisplayLabel(agent).label;
    const lastSwapAt = readJanitorLastSwapAt(agent);
    if (isWithinCooldown(lastSwapAt, now.getTime())) {
      probes.push({ agentId: agent.id, agentLabel: label, binding, outcome: { kind: "skipped_cooldown" } });
      continue;
    }
    const reasons = await detectBindingHealth(db, agent, input.companyId);
    if (reasons.length === 0) {
      probes.push({ agentId: agent.id, agentLabel: label, binding, outcome: { kind: "healthy" } });
      continue;
    }
    // Track model-level failure for outage grouping
    const errorReason = reasons.find((r) => r.errorCode);
    if (errorReason && binding.model) {
      const adapterFailures = failedModelsByAdapter.get(binding.adapterType) ?? new Map();
      adapterFailures.set(binding.model, {
        errorCode: errorReason.errorCode!,
        errorMessage: errorReason.errorMessage ?? errorReason.detail,
      });
      failedModelsByAdapter.set(binding.adapterType, adapterFailures);
    }
    probes.push({ agentId: agent.id, agentLabel: label, binding, outcome: { kind: "needs_swap", reasons } });
  }

  const swaps: JanitorReportSwap[] = [];
  const pauses: JanitorReportPause[] = [];
  let healthy = 0;
  let skippedCooldown = 0;

  for (const probe of probes) {
    if (probe.outcome.kind === "healthy") {
      healthy += 1;
      continue;
    }
    if (probe.outcome.kind === "skipped_cooldown") {
      skippedCooldown += 1;
      continue;
    }
    const agent = targets.find((a) => a.id === probe.agentId)!;
    const reasonText = summarizeReasons(probe.outcome.reasons);
    const config = { ...((agent.adapterConfig ?? {}) as Record<string, unknown>) };

    // If the current adapter is in a closed-outage list, skip same-adapter
    // ranking entirely and go straight to tier fallback.
    let replacement: { binding: AgentBinding; config: Record<string, unknown> } | null = null;
    if (!closedAdapters.has(probe.binding.adapterType)) {
      replacement = await pickReplacementOnSameAdapter(
        probe.binding,
        config,
        input.companyId,
        new Set([probe.binding.model]),
      );
    }
    if (!replacement) {
      replacement = await pickReplacementInTier(
        probe.binding,
        config,
        agent.tier,
        input.companyId,
        closedAdapters,
      );
    }

    if (replacement) {
      await applySwap(db, agent, replacement.binding, replacement.config, reasonText, now);
      swaps.push({
        agentId: agent.id,
        agentLabel: probe.agentLabel,
        from: probe.binding,
        to: replacement.binding,
        reason: reasonText,
      });
    } else {
      // No tier-safe replacement. Pause + inbox.
      await applyPause(db, agent, probe.binding, reasonText, now);
      await writePauseInbox(db, input.companyId, agent, probe.binding, reasonText, null);
      pauses.push({
        agentId: agent.id,
        agentLabel: probe.agentLabel,
        binding: probe.binding,
        reason: reasonText,
      });
    }
  }

  // Whole-adapter outage detection + escalation. Must happen AFTER swaps
  // so replacement attempts have populated failedModelsByAdapter accurately.
  const outagesDetected = await escalateOutages(db, {
    companyId: input.companyId,
    reportId,
    failedModelsByAdapter,
    hank,
  });

  const finishedAt = new Date();
  const summarySeed = deterministicSummary({
    scanned: targets.length,
    healthy,
    swapped: swaps.length,
    paused: pauses.length,
    outagesDetected,
    swaps,
    pauses,
  });
  const llmPrompt = `Sweep finished at ${finishedAt.toISOString()}. ${summarySeed}\n\nWrite a short paragraph from Hank's POV.`;
  const llmProse = hank ? await tryWriteHankProse(hank, llmPrompt) : null;
  const summaryProse = llmProse ?? summarySeed;
  const summarySource = llmProse ? "hank_gemini" : "deterministic_fallback";

  await db
    .update(janitorReports)
    .set({
      finishedAt,
      status: "completed",
      scannedCount: targets.length,
      healthyCount: healthy,
      swappedCount: swaps.length,
      pausedCount: pauses.length,
      skippedCooldownCount: skippedCooldown,
      outagesDetectedCount: outagesDetected,
      swaps,
      pauses,
      summaryProse,
      summarySource,
    })
    .where(eq(janitorReports.id, reportId));

  if (hank) {
    await logActivity(db, {
      companyId: input.companyId,
      actorType: "agent",
      actorId: hank.id,
      action: "janitor_sweep_completed",
      entityType: "janitor_report",
      entityId: reportId,
      agentId: hank.id,
      details: {
        triggeredBy: input.triggeredBy,
        scanned: targets.length,
        healthy,
        swapped: swaps.length,
        paused: pauses.length,
        outagesDetected,
      },
    });
  }

  publishLiveEvent({
    companyId: input.companyId,
    type: "janitor.sweep.completed",
    payload: {
      reportId,
      scanned: targets.length,
      healthy,
      swapped: swaps.length,
      paused: pauses.length,
      outagesDetected,
    },
  });

  return {
    reportId,
    scanned: targets.length,
    healthy,
    swapped: swaps.length,
    paused: pauses.length,
    skippedCooldown,
    outagesDetected,
  };
}

// Auto-on-error trigger. Called from the heartbeat completion path when a
// run fails with an error code that suggests broken binding. Dedupes per
// agent to avoid stampedes when an adapter is wholly down.
const autoOnErrorInflight = new Map<string, number>();

export async function maybeTriggerAutoOnError(
  db: Db,
  input: { companyId: string; agentId: string; errorCode: string | null },
): Promise<void> {
  if (!input.errorCode) return;
  if (!BROKEN_BINDING_ERROR_CODES.has(input.errorCode)) return;
  const key = `${input.companyId}:${input.agentId}`;
  const now = Date.now();
  const last = autoOnErrorInflight.get(key);
  if (last && now - last < AUTO_ON_ERROR_DEDUPE_WINDOW_MS) return;
  autoOnErrorInflight.set(key, now);

  // Best-effort: prune stale dedupe entries periodically (cap memory).
  if (autoOnErrorInflight.size > 1024) {
    for (const [k, ts] of autoOnErrorInflight.entries()) {
      if (now - ts > AUTO_ON_ERROR_DEDUPE_WINDOW_MS) autoOnErrorInflight.delete(k);
    }
  }

  // Fire-and-forget. Errors from the sweep are logged inside it.
  void runJanitorSweep(db, {
    companyId: input.companyId,
    scope: { kind: "agent", agentId: input.agentId },
    triggeredBy: "auto_on_error",
  }).catch((err) => {
    logger.warn({ err, companyId: input.companyId, agentId: input.agentId }, "janitor: auto-on-error sweep failed");
  });
}

export function _resetAutoOnErrorDedupeForTests() {
  autoOnErrorInflight.clear();
}

// Re-exports for outage subsystem (consumed by tests + routes)
export { detectAdapterOutages };

// Used by routes for the "currently paused by janitor" filter.
export async function listJanitorPausedAgents(db: Db, companyId: string) {
  // Uses LIKE to find agents whose pauseReason is from the Janitor.
  const rows = await db
    .select()
    .from(agents)
    .where(
      and(
        eq(agents.companyId, companyId),
        eq(agents.status, "paused"),
        sql`${agents.pauseReason} like 'Plug-In Janitor:%'`,
      ),
    );
  return rows;
}

// Re-exports for cost-events use (currently unused but kept to avoid future
// import churn when we add daily-spend deltas to reports).
export { costEvents, isNull };
