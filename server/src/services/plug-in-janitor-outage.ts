import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@nessie/db";
import {
  agents,
  issues,
  janitorOutages,
  inboxItems,
} from "@nessie/db";
import type { ServerAdapterModule } from "@nessie/adapter-utils";
import { getServerAdapter, listAdapterModels } from "../adapters/registry.js";
import { buildAgentDisplayLabel } from "./agents.js";
import { logger } from "../middleware/logger.js";
import type { AgentRow } from "./plug-in-janitor.js";

// Outage subsystem — detects whole-adapter failures and escalates them
// into engineering-owned issues with a Hank-drafted plan.
//
// Detection: per-adapter, requires attempted >= 2 AND failed/attempted >= 0.8
// AND dominant error code accounts for >= 70% of failures. The sweep's
// per-agent failure map is the seed; if an adapter has only 1 failed
// model recorded, we explicitly probe up to 2 more catalog models so we
// have enough signal to reason about.
//
// Anti-thrash: the (companyId, adapterType, dominantErrorCode) unique
// index plus a check-then-update flow ensures no duplicate open outages.
// On re-detection we bump observation_count and last_observed_at.

const OUTAGE_FAIL_RATIO_THRESHOLD = 0.8;
const OUTAGE_DOMINANT_ERROR_SHARE_THRESHOLD = 0.7;
const OUTAGE_MIN_ATTEMPTED = 2;
const SUPPLEMENTARY_PROBE_LIMIT = 2;
const SAMPLE_MESSAGE_LIMIT = 3;
const SAMPLE_MESSAGE_MAX_LENGTH = 240;

export type AdapterFailureRecord = { errorCode: string; errorMessage: string };

export type EscalateInput = {
  companyId: string;
  reportId: string;
  failedModelsByAdapter: Map<string, Map<string, AdapterFailureRecord>>;
  hank: AgentRow | null;
};

type DetectedOutage = {
  adapterType: string;
  dominantErrorCode: string;
  attempted: number;
  failed: number;
  failedModels: string[];
  sampleMessages: string[];
};

async function probeModel(
  adapter: ServerAdapterModule,
  baseConfig: Record<string, unknown>,
  modelId: string,
  companyId: string,
): Promise<AdapterFailureRecord | null> {
  try {
    const result = await adapter.testEnvironment({
      companyId,
      adapterType: adapter.type,
      config: { ...baseConfig, model: modelId },
    });
    if (result.status === "fail") {
      const firstError = result.checks.find((c) => c.level === "error");
      return {
        errorCode: firstError?.code ?? "unknown",
        errorMessage: firstError?.message ?? "Health probe failed",
      };
    }
    return null;
  } catch (err) {
    return {
      errorCode: "test_environment_threw",
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function detectAdapterOutages(
  input: {
    companyId: string;
    failedModelsByAdapter: Map<string, Map<string, AdapterFailureRecord>>;
  },
): Promise<DetectedOutage[]> {
  const detected: DetectedOutage[] = [];

  for (const [adapterType, failures] of input.failedModelsByAdapter.entries()) {
    let attempted = failures.size;
    let mutableFailures = new Map(failures);

    // Supplementary probing: if we have <2 attempted models, probe more
    // from the catalog to get enough signal to reason about. We probe with
    // a minimal config (no per-agent secrets); if listModels itself can't
    // produce candidates, we skip outage detection for this adapter.
    if (attempted < OUTAGE_MIN_ATTEMPTED) {
      const adapter = getServerAdapter(adapterType);
      try {
        const catalog = await listAdapterModels(adapterType);
        const tried = new Set(failures.keys());
        let probedExtra = 0;
        for (const candidate of catalog) {
          if (tried.has(candidate.id)) continue;
          if (probedExtra >= SUPPLEMENTARY_PROBE_LIMIT) break;
          const result = await probeModel(adapter, {}, candidate.id, input.companyId);
          attempted += 1;
          probedExtra += 1;
          if (result) {
            mutableFailures.set(candidate.id, result);
          }
        }
      } catch (err) {
        logger.debug({ adapterType, err }, "outage: supplementary probe failed; skipping");
        continue;
      }
    }

    if (attempted < OUTAGE_MIN_ATTEMPTED) continue;
    const failed = mutableFailures.size;
    const failRatio = failed / attempted;
    if (failRatio < OUTAGE_FAIL_RATIO_THRESHOLD) continue;

    // Tally dominant error code
    const codeCount = new Map<string, number>();
    for (const rec of mutableFailures.values()) {
      codeCount.set(rec.errorCode, (codeCount.get(rec.errorCode) ?? 0) + 1);
    }
    let dominantCode = "";
    let dominantCount = 0;
    for (const [code, count] of codeCount.entries()) {
      if (count > dominantCount) {
        dominantCode = code;
        dominantCount = count;
      }
    }
    if (!dominantCode) continue;
    if (dominantCount / failed < OUTAGE_DOMINANT_ERROR_SHARE_THRESHOLD) continue;

    // Sample messages: first SAMPLE_MESSAGE_LIMIT distinct messages, truncated
    const sampleMessages: string[] = [];
    const seenMessages = new Set<string>();
    for (const rec of mutableFailures.values()) {
      if (rec.errorCode !== dominantCode) continue;
      const truncated = rec.errorMessage.length > SAMPLE_MESSAGE_MAX_LENGTH
        ? `${rec.errorMessage.slice(0, SAMPLE_MESSAGE_MAX_LENGTH - 1)}…`
        : rec.errorMessage;
      if (seenMessages.has(truncated)) continue;
      seenMessages.add(truncated);
      sampleMessages.push(truncated);
      if (sampleMessages.length >= SAMPLE_MESSAGE_LIMIT) break;
    }

    detected.push({
      adapterType,
      dominantErrorCode: dominantCode,
      attempted,
      failed,
      failedModels: [...mutableFailures.keys()],
      sampleMessages,
    });
  }

  return detected;
}

async function loadAffectedAgentIds(
  db: Db,
  companyId: string,
  adapterType: string,
): Promise<{ agentIds: string[]; agentLabels: string[] }> {
  const rows = await db
    .select({
      id: agents.id,
      name: agents.name,
      humanFirstName: agents.humanFirstName,
      humanLastName: agents.humanLastName,
      title: agents.title,
    })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.adapterType, adapterType)));
  return {
    agentIds: rows.map((r) => r.id),
    agentLabels: rows.map((r) => buildAgentDisplayLabel(r).label),
  };
}

async function pickAssignee(
  db: Db,
  companyId: string,
  hankId: string | null,
): Promise<string | null> {
  // Preference: CTO seed if bound to a code-capable adapter
  const codeCapable: ReadonlySet<string> = new Set(["claude_local", "codex_local"]);

  const cto = await db
    .select()
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.roleTemplateKey, "exec.cto")))
    .limit(1);
  if (cto.length > 0 && codeCapable.has(cto[0]!.adapterType)) {
    return cto[0]!.id;
  }

  // Fallback: any Engineering-dept agent on a code-capable adapter, autonomy >= 3, not paused
  const engCandidates = await db
    .select()
    .from(agents)
    .where(and(eq(agents.companyId, companyId)));
  for (const candidate of engCandidates) {
    if (hankId && candidate.id === hankId) continue;
    if (candidate.status === "paused" || candidate.status === "terminated") continue;
    if (candidate.autonomyLevel < 3) continue;
    if (!codeCapable.has(candidate.adapterType)) continue;
    if (candidate.roleTemplateKey?.startsWith("eng.")) {
      return candidate.id;
    }
  }
  return null;
}

function deterministicPlan(input: {
  adapterType: string;
  dominantErrorCode: string;
  outage: DetectedOutage;
  affectedLabels: string[];
}): string {
  const lines: string[] = [];
  lines.push(`# Adapter outage: ${input.adapterType} (${input.dominantErrorCode})`);
  lines.push("");
  lines.push("## What we know");
  lines.push("");
  lines.push(`- Adapter: \`${input.adapterType}\``);
  lines.push(`- Dominant error code: \`${input.dominantErrorCode}\``);
  lines.push(`- Attempted: ${input.outage.attempted} models, Failed: ${input.outage.failed}`);
  lines.push(`- Failed models: ${input.outage.failedModels.map((m) => `\`${m}\``).join(", ")}`);
  if (input.outage.sampleMessages.length > 0) {
    lines.push("- Sample messages:");
    for (const msg of input.outage.sampleMessages) {
      lines.push(`  - ${msg}`);
    }
  }
  lines.push(`- Affected agents (${input.affectedLabels.length}): ${input.affectedLabels.slice(0, 8).join(", ")}${input.affectedLabels.length > 8 ? `, and ${input.affectedLabels.length - 8} more` : ""}`);
  lines.push("");
  lines.push("## Suspected root cause");
  lines.push("");
  const code = input.dominantErrorCode.toLowerCase();
  if (code.includes("auth") || code.includes("api_key") || code.includes("unauthorized")) {
    lines.push("Auth — credentials look invalid or have rotated. Check the company secret store and env vars.");
  } else if (code.includes("quota") || code.includes("rate")) {
    lines.push("Quota / rate-limit — provider has cut us off. Check billing dashboard or wait for reset window.");
  } else if (code.includes("model_not_found") || code.includes("non_free")) {
    lines.push("Model catalog drift — provider rotated or removed models we hardcoded. Check the adapter's model filter.");
  } else if (code.includes("network") || code.includes("timeout") || code.includes("threw")) {
    lines.push("Network / transport — endpoint unreachable, request schema drift, or response parsing error.");
  } else {
    lines.push("Unclassified. The error code does not match a known category — this is the engineer's call.");
  }
  lines.push("");
  lines.push("## Suggested files to investigate");
  lines.push("");
  lines.push(`- \`packages/adapters/${input.adapterType.replace(/_/g, "-")}/src/server/execute.ts\` — request shape and response parsing`);
  lines.push(`- \`packages/adapters/${input.adapterType.replace(/_/g, "-")}/src/server/models.ts\` — model discovery, catalog filter, env probe`);
  lines.push(`- \`packages/adapters/${input.adapterType.replace(/_/g, "-")}/src/index.ts\` — adapter manifest`);
  lines.push("");
  lines.push("_Plan source: deterministic fallback (Hank's LLM was unavailable or this is a Gemini outage)._");
  return lines.join("\n");
}

async function tryHankPlanProse(
  hank: AgentRow,
  context: {
    adapterType: string;
    dominantErrorCode: string;
    failedModels: string[];
    sampleMessages: string[];
    affectedLabels: string[];
  },
): Promise<string | null> {
  // Don't try if Hank's own adapter is the broken one.
  if (hank.adapterType === context.adapterType) return null;
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

  const prompt = [
    `Adapter: ${context.adapterType}`,
    `Dominant error code: ${context.dominantErrorCode}`,
    `Failed models: ${context.failedModels.join(", ")}`,
    `Sample errors: ${context.sampleMessages.join(" || ")}`,
    `Affected agents (${context.affectedLabels.length}): ${context.affectedLabels.slice(0, 6).join(", ")}`,
    "",
    "Write a concise outage plan markdown with these three sections (use H2): What we know, Suspected root cause, Suggested files to investigate.",
    `Files should be paths under packages/adapters/${context.adapterType.replace(/_/g, "-")}/src/server/. Do not invent diffs. Keep total under 400 words.`,
  ].join("\n");

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
        max_tokens: 800,
        messages: [
          {
            role: "system",
            content:
              "You are Hank Brennan, Plug-In Janitor. Your job here is to write a brief outage diagnosis for an engineer to act on. Be specific, no preamble, no fluff.",
          },
          { role: "user", content: prompt },
        ],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: unknown } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    return typeof content === "string" && content.trim().length > 0 ? content.trim() : null;
  } catch (err) {
    logger.debug({ err }, "outage: Hank LLM plan failed; falling back to deterministic");
    return null;
  }
}

export async function escalateOutages(
  db: Db,
  input: EscalateInput,
): Promise<number> {
  const detected = await detectAdapterOutages({
    companyId: input.companyId,
    failedModelsByAdapter: input.failedModelsByAdapter,
  });

  let escalatedCount = 0;
  for (const outage of detected) {
    // Anti-thrash: check for existing open outage on (company, adapter, code)
    const existing = await db
      .select()
      .from(janitorOutages)
      .where(
        and(
          eq(janitorOutages.companyId, input.companyId),
          eq(janitorOutages.adapterType, outage.adapterType),
          eq(janitorOutages.dominantErrorCode, outage.dominantErrorCode),
          sql`${janitorOutages.status} in ('open', 'in_progress')`,
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const row = existing[0]!;
      await db
        .update(janitorOutages)
        .set({
          observationCount: row.observationCount + 1,
          lastObservedAt: new Date(),
        })
        .where(eq(janitorOutages.id, row.id));
      continue;
    }

    const { agentIds, agentLabels } = await loadAffectedAgentIds(db, input.companyId, outage.adapterType);

    const hankProse = input.hank
      ? await tryHankPlanProse(input.hank, {
          adapterType: outage.adapterType,
          dominantErrorCode: outage.dominantErrorCode,
          failedModels: outage.failedModels,
          sampleMessages: outage.sampleMessages,
          affectedLabels: agentLabels,
        })
      : null;
    const planMarkdown = hankProse ?? deterministicPlan({
      adapterType: outage.adapterType,
      dominantErrorCode: outage.dominantErrorCode,
      outage,
      affectedLabels: agentLabels,
    });
    const planSource = hankProse ? "hank_gemini" : "deterministic_fallback";

    const assigneeAgentId = await pickAssignee(db, input.companyId, input.hank?.id ?? null);

    const issueTitle = `Adapter outage: ${outage.adapterType} (${outage.dominantErrorCode})`;
    const issueBody = [
      planMarkdown,
      "",
      "---",
      `_Opened automatically by the Plug-In Janitor (sweep report \`${input.reportId}\`)._`,
      `_Affected agent IDs: ${agentIds.join(", ") || "(none)"}_`,
    ].join("\n");

    const [issueRow] = await db
      .insert(issues)
      .values({
        companyId: input.companyId,
        title: issueTitle,
        description: issueBody,
        status: "backlog",
        priority: "high",
        assigneeAgentId: assigneeAgentId ?? undefined,
        createdByAgentId: input.hank?.id ?? undefined,
        originKind: "janitor_outage",
        originId: input.reportId,
      })
      .returning();
    const escalatedIssueId = issueRow?.id ?? null;

    await db.insert(janitorOutages).values({
      companyId: input.companyId,
      adapterType: outage.adapterType,
      dominantErrorCode: outage.dominantErrorCode,
      status: "open",
      detectedInReportId: input.reportId,
      errorPattern: {
        attempted: outage.attempted,
        failed: outage.failed,
        sampleMessages: outage.sampleMessages,
        failedModels: outage.failedModels,
      },
      affectedAgentIds: agentIds,
      planMarkdown,
      planSource,
      escalatedIssueId: escalatedIssueId ?? undefined,
      assigneeAgentId: assigneeAgentId ?? undefined,
    });

    if (!assigneeAgentId) {
      await db.insert(inboxItems).values({
        companyId: input.companyId,
        kind: "janitor_outage_no_assignee",
        bodyMarkdown: `**Adapter outage on \`${outage.adapterType}\`** (${outage.dominantErrorCode}). No code-capable engineer agent available to assign. Issue: ${escalatedIssueId ?? "(none)"}`,
        refs: escalatedIssueId
          ? [{ kind: "issue", ref: escalatedIssueId }]
          : [],
      });
    }

    escalatedCount += 1;
  }

  // Resolution sweep: for any open outages on adapters NOT in the current
  // failure map (or where most previously-failed models now pass), check
  // for resolution. We only handle the "no longer in failure map" case
  // here (cheap); a full re-probe would require more work and is deferred.
  const openOutages = await db
    .select()
    .from(janitorOutages)
    .where(
      and(
        eq(janitorOutages.companyId, input.companyId),
        sql`${janitorOutages.status} in ('open', 'in_progress')`,
      ),
    );
  for (const open of openOutages) {
    const stillFailing = input.failedModelsByAdapter.has(open.adapterType);
    if (stillFailing) continue;
    // Re-probe a sample of the previously-failed models. If >=50% pass, mark resolved.
    const adapter = getServerAdapter(open.adapterType);
    const sample = open.errorPattern.failedModels.slice(0, 3);
    if (sample.length === 0) continue;
    let passed = 0;
    for (const modelId of sample) {
      const result = await probeModel(adapter, {}, modelId, input.companyId);
      if (!result) passed += 1;
    }
    if (passed / sample.length >= 0.5) {
      await db
        .update(janitorOutages)
        .set({ status: "resolved", resolvedAt: new Date() })
        .where(eq(janitorOutages.id, open.id));
    }
  }

  return escalatedCount;
}
