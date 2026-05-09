import { api } from "./client";

// Server source: `services/{agent-bus,work-contracts,black-box,reputation}.ts`
// + `routes/trust-layer.ts`.

export const BUS_KINDS = [
  "handoff",
  "review_request",
  "clarification_request",
  "budget_request",
  "policy_check",
  "meeting_invite",
  "evidence_request",
  "hiring_request",
  "incident_escalation",
  "operator_approval_request",
] as const;
export type BusKind = (typeof BUS_KINDS)[number];

export type BusStatus = "pending" | "delivered" | "replied" | "expired" | "dismissed";

export interface BusMessage {
  id: string;
  companyId: string;
  fromAgentId: string | null;
  toAgentId: string | null;
  kind: BusKind;
  payload: Record<string, unknown>;
  parentMessageId: string | null;
  status: BusStatus;
  senderAutonomyLevel: number | null;
  createdAt: string;
  updatedAt: string;
}

export type ContractState =
  | "draft" | "accepted" | "in_progress" | "submitted" | "approved" | "rejected" | "abandoned";

export interface WorkContract {
  id: string;
  issueId: string;
  ownerAgentId: string | null;
  reviewerAgentId: string | null;
  state: ContractState;
  acceptanceCriteria: Array<Record<string, unknown>>;
  evidence: Array<{ kind: string; ref: string; summary?: string | null }>;
  toolBoundaries: Record<string, unknown> | null;
  budgetCents: number | null;
  deadlineAt: string | null;
  escalationPolicy: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export type BlackBoxScope = "run" | "meeting" | "hire" | "incident" | "decision";

export interface BlackBoxRecord {
  id: string;
  scope: BlackBoxScope;
  scopeId: string;
  label: string | null;
  snapshot: Record<string, unknown>;
  createdAt: string;
}

export const REPUTATION_DIMENSIONS = [
  "speed",
  "quality",
  "cost",
  "reliability",
  "judgment",
  "collaboration",
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
  createdAt: string;
}

export const trustLayerApi = {
  listBus: (companyId: string, kind?: BusKind, status?: BusStatus) => {
    const params = new URLSearchParams();
    params.set("companyId", companyId);
    if (kind) params.set("kind", kind);
    if (status) params.set("status", status);
    return api.get<{ messages: BusMessage[] }>(`/bus/messages?${params.toString()}`);
  },
  setBusStatus: (id: string, status: BusStatus) =>
    api.post<{ message: BusMessage }>(`/bus/messages/${id}/status`, { status }),
  contractByIssue: (issueId: string) =>
    api.get<{ contract: WorkContract }>(`/work-contracts/by-issue/${issueId}`),
  transitionContract: (id: string, to: ContractState) =>
    api.post<{ contract: WorkContract }>(`/work-contracts/${id}/transition`, { to }),
  listBlackBox: (scope: BlackBoxScope, scopeId: string) =>
    api.get<{ records: BlackBoxRecord[] }>(
      `/black-box?scope=${encodeURIComponent(scope)}&scopeId=${encodeURIComponent(scopeId)}`,
    ),
  listReputation: (agentId: string) =>
    api.get<{ events: ReputationEvent[] }>(`/reputation/${agentId}`),
};
