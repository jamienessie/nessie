import { api } from "./client";

// Server source: `services/chief-of-staff.ts` + `routes/chief-of-staff.ts`.
//
// The service returns an intent classification plus a summary line and an
// array of sections, each section being a heading + an array of opaque
// rows. The shape is intentionally permissive — different intents emit
// different row shapes (issues, bus messages, cost rows, etc.).
//
// `kind` on each section is a discriminant the UI uses to pick the right
// renderer (issue row vs cost table vs agent row, etc.). Server tags
// known sections; legacy responses without `kind` fall back to a generic
// table renderer so we never break.

export type ChiefSectionKind =
  | "agents"
  | "issues"
  | "meetings"
  | "costs"
  | "approvals"
  | "inbox"
  | "hires"
  | "generic";

export interface ChiefSection {
  heading: string;
  /** Optional discriminant — when present, UI picks an intent-specific renderer. */
  kind?: ChiefSectionKind;
  rows: Array<Record<string, unknown>>;
}

export interface ChiefResponse {
  intent: string;
  summary: string;
  /** Original template summary, kept when an LLM rewrote `summary`. Useful for debug. */
  templateSummary?: string;
  sections: ChiefSection[];
}

export interface ChiefDashboardCounts {
  blockedIssues: number;
  pendingApprovals: number;
  liveAgents: number;
  weekSpendCents: number;
  openContracts: number;
  lowRepAgents: number;
  todaysMeetingsCount: number;
}

function qs(companyId: string): string {
  return `?companyId=${encodeURIComponent(companyId)}`;
}

export const chiefOfStaffApi = {
  ask: (companyId: string, command: string) =>
    api.post<ChiefResponse>(`/chief/ask${qs(companyId)}`, { command }),
  dashboard: (companyId: string) =>
    api.get<ChiefDashboardCounts>(`/chief/dashboard${qs(companyId)}`),
};
