import { api } from "./client";

// Phase 6 agent bus surface. Backend at server/src/routes/trust-layer.ts.

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

export const BUS_STATUSES = ["pending", "delivered", "replied", "expired", "dismissed"] as const;
export type BusStatus = (typeof BUS_STATUSES)[number];

export interface BusMessage {
  id: string;
  companyId: string;
  fromAgentId: string | null;
  toAgentId: string | null;
  kind: string;
  payload: Record<string, unknown>;
  status: BusStatus;
  parentMessageId: string | null;
  expiresAt: string | null;
  deliveredAt: string | null;
  repliedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function qs(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export const busApi = {
  list: (companyId: string, opts?: { kind?: BusKind; status?: BusStatus }) =>
    api.get<{ messages: BusMessage[] }>(
      `/bus/messages${qs({ companyId, kind: opts?.kind, status: opts?.status })}`,
    ),
  markStatus: (messageId: string, status: BusStatus) =>
    api.post<{ message: BusMessage }>(`/bus/messages/${encodeURIComponent(messageId)}/status`, { status }),
};
