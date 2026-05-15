// Plan §next-up. Auto-Router service.
//
// Closes the Arena loop. Heartbeat dispatch consults the Arena
// leaderboard before picking a model for an agent's run; if a winner
// exists for the (companyId, taskType) cell, override the agent's
// configured model with the winner.
//
// Scope decisions for v1:
//   - taskType is taken from the agent's role (e.g. "engineer",
//     "designer", "general"). One model per role per company. This is
//     coarse, but it's what the Arena leaderboard groups by today
//     ('summarize', 'refactor', etc. are operator-defined task_types).
//     Operator can run an Arena tagged with the role they want to
//     improve and the next dispatch will pick up the winner.
//   - Opt-in per agent via runtimeConfig.autoRouter === true. Default
//     OFF so existing agents don't silently rebind to a different
//     model.
//   - If the winner has < MIN_WINS, keep the configured model
//     (don't act on a single noisy data point).
//   - If the agent's tier doesn't match the winner's tier prefix,
//     keep the configured model. Auto-Router doesn't cross tiers.

import type { Db } from "@nessie/db";
import { arenaService } from "./arena-service.js";

const MIN_WINS = 2;

export interface RoutedModel {
  model: string;
  source: "leaderboard" | "configured";
  reason?: string;
}

export interface AutoRouterAgentInput {
  id: string;
  companyId: string;
  role: string;
  runtimeConfig: Record<string, unknown> | null;
  adapterConfig: Record<string, unknown> | null;
  tier?: string | null;
}

function configuredModel(agent: AutoRouterAgentInput): string | null {
  const m = agent.adapterConfig?.model;
  return typeof m === "string" && m.trim().length > 0 ? m : null;
}

function tierPrefix(model: string): "t1:" | "t2:" | "t3:" | null {
  const lower = model.toLowerCase();
  if (lower.startsWith("t1:")) return "t1:";
  if (lower.startsWith("t2:")) return "t2:";
  if (lower.startsWith("t3:")) return "t3:";
  return null;
}

function agentTierPrefix(agent: AutoRouterAgentInput): "t1:" | "t2:" | "t3:" | null {
  if (agent.tier === "T1") return "t1:";
  if (agent.tier === "T2") return "t2:";
  if (agent.tier === "T3") return "t3:";
  return null;
}

export async function resolveAutoRoutedModel(
  db: Db,
  agent: AutoRouterAgentInput,
): Promise<RoutedModel> {
  const enabled = agent.runtimeConfig?.autoRouter === true;
  const configured = configuredModel(agent);
  if (!enabled) {
    return { model: configured ?? "", source: "configured", reason: "auto_router_disabled" };
  }

  const taskType = (agent.role ?? "general").trim() || "general";
  const board = await arenaService(db).leaderboard(agent.companyId, { taskType });
  if (board.length === 0) {
    return { model: configured ?? "", source: "configured", reason: "no_leaderboard_data" };
  }
  const winner = board[0];
  if (winner.wins < MIN_WINS) {
    return { model: configured ?? "", source: "configured", reason: `winner_below_min_wins(${winner.wins})` };
  }
  const expectedTier = agentTierPrefix(agent);
  if (expectedTier && tierPrefix(winner.model) !== expectedTier) {
    return {
      model: configured ?? "",
      source: "configured",
      reason: `winner_tier_mismatch(${winner.model})`,
    };
  }
  return { model: winner.model, source: "leaderboard", reason: `winner_wins(${winner.wins})` };
}
