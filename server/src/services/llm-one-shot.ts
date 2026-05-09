import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { agents } from "@nessie/db";
import { findActiveServerAdapter } from "../adapters/registry.js";
import { parseClaudeStreamJson } from "@nessie/adapter-claude-local/server";
import { parseCodexJsonl } from "@nessie/adapter-codex-local/server";

// Shared one-shot LLM helper.
//
// Many places in the server need to ask an LLM a single question and
// get back a clean text answer (no streaming, no session, no work
// contract). The meeting orchestrator was the first caller; the
// chief-of-staff narrative summary is the second. Future callers
// (executive briefs, candidate scorecards, …) will plug in here.
//
// Adapter resolution: caller passes an `agentId`. We fetch the agent's
// adapterType + adapterConfig and route the call through the existing
// adapter registry. Stdout is parsed per-adapter so claude_local /
// codex_local return clean assistant text instead of raw stream-json.

export interface OneShotResult {
  ok: true;
  text: string;
  costCents: number;
}

export interface OneShotFailure {
  ok: false;
  error: string;
  /** Timeouts and other clear "broken adapter" signals — caller may want to skip this agent. */
  terminal?: boolean;
}

export interface RunOneShotInput {
  db: Db;
  agentId: string;
  prompt: string;
  /** Override the default 60s timeout. Pass milliseconds. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

function extractAssistantText(adapterType: string, stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  if (adapterType === "claude_local") {
    return parseClaudeStreamJson(stdout).summary || trimmed;
  }
  if (adapterType === "codex_local") {
    return parseCodexJsonl(stdout).summary || trimmed;
  }
  return trimmed;
}

/**
 * Send `prompt` to the agent's adapter, return the assistant text or an
 * error. Never throws — always returns a discriminated result the
 * caller can branch on.
 */
export async function runOneShotAdapterCall(
  input: RunOneShotInput,
): Promise<OneShotResult | OneShotFailure> {
  const rows = await input.db
    .select({
      id: agents.id,
      companyId: agents.companyId,
      name: agents.name,
      adapterType: agents.adapterType,
      adapterConfig: agents.adapterConfig,
    })
    .from(agents)
    .where(eq(agents.id, input.agentId))
    .limit(1);
  const agent = rows[0];
  if (!agent) return { ok: false, error: `agent ${input.agentId} not found` };

  const adapter = findActiveServerAdapter(agent.adapterType);
  if (!adapter) return { ok: false, error: `no active adapter for type "${agent.adapterType}"` };

  let stdout = "";
  let stderr = "";
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  try {
    const executePromise = adapter.execute({
      runId: randomUUID(),
      agent: {
        id: agent.id,
        companyId: agent.companyId,
        name: agent.name,
        adapterType: agent.adapterType,
        adapterConfig: (agent.adapterConfig ?? {}) as Record<string, unknown>,
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: (agent.adapterConfig ?? {}) as Record<string, unknown>,
      context: { prompt: input.prompt },
      onLog: async (stream, chunk) => {
        if (stream === "stdout") stdout += chunk;
        else stderr += chunk;
      },
    });
    const result = await Promise.race([
      executePromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`one-shot timed out after ${timeoutMs / 1000}s`)), timeoutMs),
      ),
    ]);
    if (result.exitCode !== 0) {
      const message = result.errorMessage ?? stderr.trim() ?? `adapter exit ${result.exitCode}`;
      return { ok: false, error: message };
    }
    const text = extractAssistantText(agent.adapterType, stdout);
    if (!text) return { ok: false, error: "adapter produced empty response" };
    const costCents = typeof result.costUsd === "number" ? Math.round(result.costUsd * 100) : 0;
    return { ok: true, text, costCents };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const terminal = /timed out/i.test(message);
    return { ok: false, error: message, terminal };
  }
}

/**
 * Find the first agent in `companyId` whose adapter type matches one of
 * the provided preferences. Order matters — earlier preferences win.
 *
 * Used for "pick a backbone LLM agent for this company" without
 * needing a dedicated assistant role.
 */
export async function findAgentForOneShot(input: {
  db: Db;
  companyId: string;
  preferAdapterTypes?: string[];
}): Promise<string | null> {
  const preferred = input.preferAdapterTypes ?? [
    "azure_openai",
    "openrouter_compatible",
    "openai_compatible",
    "claude_local",
    "codex_local",
  ];
  const rows = await input.db
    .select({ id: agents.id, adapterType: agents.adapterType })
    .from(agents)
    .where(eq(agents.companyId, input.companyId));
  for (const wanted of preferred) {
    const match = rows.find((r) => r.adapterType === wanted);
    if (match) return match.id;
  }
  return null;
}
