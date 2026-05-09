import { api } from "./client";

// Server source: `services/chief-of-staff.ts` + `routes/chief-of-staff.ts`.
//
// The service returns an intent classification plus a summary line and an
// array of sections, each section being a heading + an array of opaque
// rows. The shape is intentionally permissive — different intents emit
// different row shapes (issues, bus messages, cost rows, etc.).

export interface ChiefSection {
  heading: string;
  rows: Array<Record<string, unknown>>;
}

export interface ChiefResponse {
  intent: string;
  summary: string;
  sections: ChiefSection[];
}

function qs(companyId: string): string {
  return `?companyId=${encodeURIComponent(companyId)}`;
}

export const chiefOfStaffApi = {
  ask: (companyId: string, command: string) =>
    api.post<ChiefResponse>(`/chief/ask${qs(companyId)}`, { command }),
};
