import { eq, sql } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { credentials as credentialsTable } from "@nessie/db";
import type { CredentialView, Tier } from "./types.js";

// Cost meter: writes a cost_events row per upstream response and updates the
// credential's running monthly spend.
//
// For T1 (subscription) calls, costCents is always 0 — the seat is a sunk
// cost and the proxy still records the call so the operator can see the
// volume routed via subscriptions vs paid APIs.
//
// For T2/T3, we read OpenAI-shape `usage` from the response body and
// compute cost from a simple per-provider rate table. Real-world rates vary
// per model; v1 intentionally uses coarse estimates and lets the operator
// reconcile from invoices.

export type UsageBlock = {
  prompt_tokens?: number;
  completion_tokens?: number;
  cached_input_tokens?: number;
};

export type RecordCostInput = {
  credential: CredentialView;
  tier: Tier;
  model: string;
  usage: UsageBlock | undefined;
  // Optional, threaded from headers (so the cost row can join the heartbeat
  // / agent / company).
  agentId: string | null;
  companyId: string | null;
  heartbeatRunId: string | null;
};

export async function recordCost(db: Db, input: RecordCostInput): Promise<void> {
  const usage = input.usage ?? {};
  const inputTokens = usage.prompt_tokens ?? 0;
  const outputTokens = usage.completion_tokens ?? 0;
  const cachedInputTokens = usage.cached_input_tokens ?? 0;

  const costCents = input.tier === "T1"
    ? 0
    : estimateCostCents(input.credential.provider, input.model, inputTokens, outputTokens);

  // We have a NOT NULL constraint on company_id and agent_id in cost_events.
  // For Phase 0, if those headers aren't supplied (e.g. a manual curl test),
  // we skip the write rather than fail. Heartbeat-driven calls always set
  // them via the X-Nessie-Agent / X-Nessie-Company headers.
  if (!input.agentId || !input.companyId) return;

  // Direct insert via raw sql to avoid importing the cost_events column refs
  // here (keeps the proxy package's compile-time surface narrow).
  await db.execute(sql`
    insert into cost_events
      (company_id, agent_id, heartbeat_run_id, billing_code, provider, biller, billing_type, model,
       input_tokens, cached_input_tokens, output_tokens, cost_cents, occurred_at)
    values
      (${input.companyId}, ${input.agentId}, ${input.heartbeatRunId},
       ${`tier:${input.tier}`}, ${input.credential.provider},
       ${input.credential.displayName}, ${input.tier === "T1" ? "subscription" : "per_token"},
       ${input.model}, ${inputTokens}, ${cachedInputTokens}, ${outputTokens},
       ${costCents}, now())
  `);

  // Update running monthly spend on the credential. T1 is exempt (sunk cost).
  if (input.tier !== "T1" && costCents > 0) {
    await db
      .update(credentialsTable)
      .set({
        monthlySpentCents: sql`${credentialsTable.monthlySpentCents} + ${costCents}`,
        updatedAt: new Date(),
      })
      .where(eq(credentialsTable.id, input.credential.id));
  }
}

// Coarse cost estimate in cents. v1 ranges; refined per-model rates land in
// Phase 1 once the openai-compatible adapter is wiring real responses.
function estimateCostCents(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const m = model.toLowerCase();

  // Free tiers
  if (provider === "openrouter" && /:free$/.test(m)) return 0;
  if (provider === "fireworks" && /free|trial/.test(m)) return 0;

  // Per-million-token rates ($/Mtok), coarse defaults.
  let inRate = 0.5; // input $/Mtok default
  let outRate = 1.5; // output $/Mtok default

  if (m.includes("gpt-4o-mini")) { inRate = 0.15; outRate = 0.60; }
  else if (m.includes("gpt-4o")) { inRate = 2.50; outRate = 10.00; }
  else if (m.includes("o1") || m.includes("o3")) { inRate = 15.00; outRate = 60.00; }
  else if (m.includes("claude-3-5-haiku")) { inRate = 0.80; outRate = 4.00; }
  else if (m.includes("claude-3-5-sonnet") || m.includes("claude-sonnet-4")) { inRate = 3.00; outRate = 15.00; }
  else if (m.includes("claude-opus-4")) { inRate = 15.00; outRate = 75.00; }
  else if (m.includes("llama-3.1-405")) { inRate = 1.00; outRate = 1.50; }
  else if (m.includes("llama-3.1-70")) { inRate = 0.30; outRate = 0.40; }
  else if (m.includes("llama-3.1-8")) { inRate = 0.10; outRate = 0.10; }
  else if (m.includes("mixtral")) { inRate = 0.27; outRate = 0.27; }

  const inputDollars = (inputTokens / 1_000_000) * inRate;
  const outputDollars = (outputTokens / 1_000_000) * outRate;
  return Math.ceil((inputDollars + outputDollars) * 100);
}
