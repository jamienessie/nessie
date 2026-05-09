import { api } from "./client";

// HR pipeline shapes. Server source: `services/hires.ts` +
// `routes/hires.ts`.

export const HIRE_STATES = [
  "open",
  "sourcing",
  "interviewing",
  "trial",
  "recommended",
  "hired",
  "rejected",
] as const;
export type HireState = (typeof HIRE_STATES)[number];

export const CANDIDATE_STATES = [
  "proposed",
  "interviewing",
  "trial",
  "recommended",
  "offered",
  "accepted",
  "declined",
  "rejected",
] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

// Allowed forward transitions per state, mirroring HIRE_TRANSITIONS in
// the service. Used to compute the next-step button on the UI.
export const HIRE_NEXT_STATES: Record<HireState, HireState[]> = {
  open: ["sourcing", "rejected"],
  sourcing: ["interviewing", "rejected"],
  interviewing: ["trial", "recommended", "rejected"],
  trial: ["recommended", "rejected"],
  recommended: ["hired", "rejected"],
  hired: [],
  rejected: [],
};

export interface RoleTemplate {
  key: string;
  title: string;
  defaultDepartmentKey: string | null;
  humanFirstName: string | null;
  humanLastName: string | null;
  defaultTier: "T1" | "T2" | "T3" | null;
  description: string | null;
}

export interface Hire {
  id: string;
  companyId: string;
  title: string;
  description: string | null;
  status: HireState;
  requestedTier: "T1" | "T2" | "T3" | null;
  requestedRoleTemplateKey: string | null;
  requestedDepartmentId: string | null;
  packet: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export interface Candidate {
  id: string;
  hireId: string;
  humanFirstName: string;
  humanLastName: string;
  title: string;
  status: CandidateState;
  summary: string | null;
  resumeMarkdown: string | null;
  sourceTemplateKey: string | null;
  proposedAdapterType: string | null;
  createdAt: string;
}

export interface Scorecard {
  id: string;
  candidateId: string;
  pass: "interview" | "trial" | "final";
  rubric: Array<{ criterion: string; weight: number; score: number; note?: string }>;
  recommendation:
    | "strong_hire" | "hire" | "weak_hire" | "no_hire" | "strong_no_hire" | null;
  notes: string | null;
  createdAt: string;
}

function qs(companyId: string): string {
  return `?companyId=${encodeURIComponent(companyId)}`;
}

export const hiresApi = {
  listRoleTemplates: () =>
    api.get<{ templates: RoleTemplate[] }>(`/role-templates`),
  list: (companyId: string, status?: HireState) => {
    const params = new URLSearchParams();
    params.set("companyId", companyId);
    if (status) params.set("status", status);
    return api.get<{ hires: Hire[] }>(`/hires?${params.toString()}`);
  },
  get: (companyId: string, id: string) =>
    api.get<{ hire: Hire; candidates: Candidate[] }>(`/hires/${id}${qs(companyId)}`),
  create: (companyId: string, body: {
    title: string;
    description?: string | null;
    requestedRoleTemplateKey?: string | null;
    requestedDepartmentId?: string | null;
    requestedTier?: "T1" | "T2" | "T3" | null;
  }) => api.post<{ hire: Hire }>(`/hires${qs(companyId)}`, body),
  transition: (companyId: string, id: string, to: HireState) =>
    api.post<{ hire: Hire }>(`/hires/${id}/transition${qs(companyId)}`, { to }),
  addCandidate: (hireId: string, body: {
    humanFirstName: string;
    humanLastName: string;
    title: string;
    summary?: string | null;
    sourceTemplateKey?: string | null;
    proposedAdapterType?: string | null;
  }) => api.post<{ candidate: Candidate }>(`/hires/${hireId}/candidates`, body),
  setCandidateStatus: (candidateId: string, to: CandidateState) =>
    api.post<{ candidate: Candidate }>(`/candidates/${candidateId}/status`, { to }),
  listScorecards: (candidateId: string) =>
    api.get<{ scorecards: Scorecard[] }>(`/candidates/${candidateId}/scorecards`),
  hireCandidate: (companyId: string, candidateId: string, body: {
    hireId: string;
    finalFirstName: string;
    finalLastName: string;
    finalTitle: string;
    finalTier: "T1" | "T2" | "T3";
    finalAdapterType: string;
    finalDepartmentId?: string | null;
    finalAutonomyLevel?: number;
    roleTemplateKey?: string | null;
  }) => api.post<{ agent: { id: string; name: string } }>(
    `/candidates/${candidateId}/hire${qs(companyId)}`,
    body,
  ),
};
