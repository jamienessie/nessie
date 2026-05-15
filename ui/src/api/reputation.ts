import { api } from "./client";

// Phase 6 reputation. Backend at server/src/routes/trust-layer.ts.

export const REPUTATION_DIMENSIONS = [
  "quality",
  "speed",
  "cost_efficiency",
  "reliability",
  "review_pass_rate",
  "collaboration",
  "meeting_usefulness",
  "evidence_quality",
  "policy_compliance",
  "operator_trust",
] as const;
export type ReputationDimension = (typeof REPUTATION_DIMENSIONS)[number];

export interface ReputationEvent {
  id: string;
  agentId: string;
  dimension: ReputationDimension;
  delta: number;
  reason: string;
  evidenceRef: string | null;
  metadata: Record<string, unknown> | null;
  occurredAt: string;
}

export const reputationApi = {
  listEvents: (agentId: string) =>
    api.get<{ events: ReputationEvent[] }>(`/reputation/${encodeURIComponent(agentId)}`),
};
