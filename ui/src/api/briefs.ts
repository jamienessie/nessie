import { api } from "./client";

// Server source: `services/executive-briefs.ts` +
// `routes/executive-briefs.ts`. The service returns the structured
// brief inline; in v1 there is no list endpoint (briefs aren't
// persisted yet). Phase 11 surfaces the compose endpoint and renders
// the response inline.

export type BriefPeriod = "daily" | "weekly" | "monthly";

export interface BriefSection {
  heading: string;
  rows: Array<Record<string, unknown>>;
}

export interface ExecutiveBrief {
  period: BriefPeriod;
  range: { fromIso: string; toIso: string };
  costSummary: { T1: number; T2: number; T3: number; total: number };
  sections: BriefSection[];
  citations: string[];
}

function qs(companyId: string): string {
  return `?companyId=${encodeURIComponent(companyId)}`;
}

export const briefsApi = {
  compose: (companyId: string, period: BriefPeriod) =>
    api.post<{ brief: ExecutiveBrief }>(`/briefs/compose${qs(companyId)}`, { period }),
};
