import { api } from "./client";

// Server source: `services/meetings.ts` + `routes/meetings.ts`.

export const MEETING_MODES = [
  "operator_led",
  "facilitator_led",
  "roundtable",
  "debate",
  "silent_first",
  "interview",
  "emergency",
] as const;
export type MeetingMode = (typeof MEETING_MODES)[number];

export const MEETING_STATES = [
  "draft",
  "preparing",
  "active",
  "waiting_for_operator",
  "synthesizing",
  "completed",
  "abandoned",
  "failed",
] as const;
export type MeetingState = (typeof MEETING_STATES)[number];

export const MEETING_NEXT_STATES: Record<MeetingState, MeetingState[]> = {
  draft: ["preparing", "abandoned"],
  preparing: ["active", "abandoned", "failed"],
  active: ["waiting_for_operator", "synthesizing", "abandoned", "failed"],
  waiting_for_operator: ["active", "abandoned"],
  synthesizing: ["completed", "failed"],
  completed: [],
  abandoned: [],
  failed: [],
};

export type OutcomeKind = "DECIDE" | "ACTION" | "MEMORY" | "ISSUE";

export interface Meeting {
  id: string;
  companyId: string;
  title: string;
  mode: MeetingMode;
  agendaMarkdown: string | null;
  state: MeetingState;
  departmentId: string | null;
  facilitatorAgentId: string | null;
  budgetCents: number | null;
  spentCents: number;
  turnLimit: number | null;
  turnsUsed: number;
  scheduledAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface Participant {
  id: string;
  meetingId: string;
  agentId: string;
  role: string;
  joinedAt: string;
}

export interface Message {
  id: string;
  meetingId: string;
  agentId: string | null;
  role: "agent" | "operator" | "system" | "tool";
  bodyMarkdown: string;
  toolCalls: Array<Record<string, unknown>> | null;
  costCents: number;
  turnIndex: number;
  createdAt: string;
}

export interface Outcome {
  id: string;
  meetingId: string;
  kind: OutcomeKind;
  payload: Record<string, unknown>;
  approvedByOperator: boolean;
  approvedAt: string | null;
  appliedAt: string | null;
  createdAt: string;
}

function qs(companyId: string): string {
  return `?companyId=${encodeURIComponent(companyId)}`;
}

export const meetingsApi = {
  list: (companyId: string, state?: MeetingState, limit?: number) => {
    const params = new URLSearchParams();
    params.set("companyId", companyId);
    if (state) params.set("state", state);
    if (limit) params.set("limit", String(limit));
    return api.get<{ meetings: Meeting[] }>(`/meetings?${params.toString()}`);
  },
  get: (companyId: string, id: string) =>
    api.get<{
      meeting: Meeting;
      participants: Participant[];
      messages: Message[];
      outcomes: Outcome[];
    }>(`/meetings/${id}${qs(companyId)}`),
  create: (companyId: string, body: {
    title: string;
    mode?: MeetingMode;
    agendaMarkdown?: string | null;
    departmentId?: string | null;
    facilitatorAgentId?: string | null;
    budgetCents?: number;
    turnLimit?: number;
    scheduledAt?: string | null;
    participants?: Array<{ agentId: string; role?: string }>;
  }) => api.post<{ meeting: Meeting }>(`/meetings${qs(companyId)}`, body),
  transition: (companyId: string, id: string, to: MeetingState) =>
    api.post<{ meeting: Meeting }>(`/meetings/${id}/transition${qs(companyId)}`, { to }),
  addParticipant: (id: string, agentId: string, role?: string) =>
    api.post<{ participant: Participant | null }>(
      `/meetings/${id}/participants`,
      { agentId, role },
    ),
  addMessage: (id: string, body: {
    agentId?: string | null;
    role: "agent" | "operator" | "system" | "tool";
    bodyMarkdown: string;
    costCents?: number;
  }) => api.post<{ message: Message }>(`/meetings/${id}/messages`, body),
  addOutcome: (id: string, kind: OutcomeKind, payload: Record<string, unknown>) =>
    api.post<{ outcome: Outcome }>(`/meetings/${id}/outcomes`, { kind, payload }),
  approveOutcome: (outcomeId: string) =>
    api.post<{ outcome: Outcome }>(`/meetings/outcomes/${outcomeId}/approve`, {}),
  applyOutcomes: (id: string) =>
    api.post<{ applied: number }>(`/meetings/${id}/apply-outcomes`, {}),
};
