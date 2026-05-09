import { api } from "./client";

// Server source: services/plug-in-janitor.ts + services/plug-in-janitor-outage.ts
// + routes/plug-in-janitor.ts. Surfaces: sweep run/list/detail, outage
// list/detail/resolve, the Hank identity row, and the "currently paused
// by Hank" agent filter.

export interface JanitorReportSwap {
  agentId: string;
  agentLabel: string;
  from: { adapterType: string; model: string };
  to: { adapterType: string; model: string };
  reason: string;
}

export interface JanitorReportPause {
  agentId: string;
  agentLabel: string;
  binding: { adapterType: string; model: string };
  reason: string;
}

export interface JanitorReport {
  id: string;
  companyId: string;
  triggeredBy: "manual" | "scheduled" | "auto_on_error";
  triggeredByUserId: string | null;
  scope: { kind: "all" } | { kind: "agent"; agentId: string };
  startedAt: string;
  finishedAt: string | null;
  status: "running" | "completed" | "failed";
  scannedCount: number;
  healthyCount: number;
  swappedCount: number;
  pausedCount: number;
  skippedCooldownCount: number;
  outagesDetectedCount: number;
  swaps: JanitorReportSwap[];
  pauses: JanitorReportPause[];
  summaryProse: string | null;
  summarySource: "hank_gemini" | "deterministic_fallback" | null;
  errorMessage: string | null;
}

export interface JanitorOutage {
  id: string;
  companyId: string;
  adapterType: string;
  dominantErrorCode: string;
  detectedAt: string;
  resolvedAt: string | null;
  status: "open" | "in_progress" | "resolved" | "abandoned";
  detectedInReportId: string | null;
  errorPattern: {
    attempted: number;
    failed: number;
    sampleMessages: string[];
    failedModels: string[];
  };
  affectedAgentIds: string[];
  planMarkdown: string;
  planSource: "hank_gemini" | "deterministic_fallback";
  escalatedIssueId: string | null;
  assigneeAgentId: string | null;
  lastObservedAt: string;
  observationCount: number;
}

export interface JanitorRunResult {
  reportId: string;
  scanned: number;
  healthy: number;
  swapped: number;
  paused: number;
  skippedCooldown: number;
  outagesDetected: number;
}

export interface JanitorIdentity {
  janitor: {
    id: string;
    name: string;
    humanFirstName: string;
    humanLastName: string;
    title: string | null;
    status: string;
    adapterType: string;
    adapterConfig: Record<string, unknown>;
    metadata: Record<string, unknown> | null;
  } | null;
}

export interface PausedAgentRow {
  id: string;
  name: string;
  humanFirstName: string;
  humanLastName: string;
  title: string | null;
  pauseReason: string | null;
  pausedAt: string | null;
  metadata: Record<string, unknown> | null;
}

export const plugInJanitorApi = {
  identity: (companyId: string) =>
    api.get<JanitorIdentity>(`/companies/${encodeURIComponent(companyId)}/janitor/identity`),
  run: (companyId: string, opts: { agentId?: string } = {}) =>
    api.post<JanitorRunResult>(`/companies/${encodeURIComponent(companyId)}/janitor/run`, opts),
  reports: (companyId: string, limit = 20) =>
    api.get<{ reports: JanitorReport[] }>(`/companies/${encodeURIComponent(companyId)}/janitor/reports?limit=${limit}`),
  reportDetail: (companyId: string, reportId: string) =>
    api.get<JanitorReport>(`/companies/${encodeURIComponent(companyId)}/janitor/reports/${encodeURIComponent(reportId)}`),
  outages: (companyId: string, status?: "open" | "resolved") => {
    const q = status ? `?status=${status}` : "";
    return api.get<{ outages: JanitorOutage[] }>(`/companies/${encodeURIComponent(companyId)}/janitor/outages${q}`);
  },
  outageDetail: (companyId: string, outageId: string) =>
    api.get<JanitorOutage>(`/companies/${encodeURIComponent(companyId)}/janitor/outages/${encodeURIComponent(outageId)}`),
  resolveOutage: (companyId: string, outageId: string) =>
    api.post<JanitorOutage>(`/companies/${encodeURIComponent(companyId)}/janitor/outages/${encodeURIComponent(outageId)}/resolve`, {}),
  pausedAgents: (companyId: string) =>
    api.get<{ agents: PausedAgentRow[] }>(`/companies/${encodeURIComponent(companyId)}/janitor/paused-agents`),
};
