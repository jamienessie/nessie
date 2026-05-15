import { api } from "./client";

/** A "dream" is an `inbox_items` row with `kind: "dream"`. Same shape. */
export interface Dream {
  id: string;
  companyId: string;
  kind: "dream";
  bodyMarkdown: string | null;
  refs: Array<{ kind: string; ref: string; summary?: string }>;
  status: string;
  triagedAt: string | null;
  triagedNotes: string | null;
  promotedKind: string | null;
  promotedId: string | null;
  capturedByAgentId: string | null;
  capturedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DreamCaptureInput {
  bodyMarkdown: string;
  capturedByAgentId?: string | null;
  refs?: Array<{ kind: string; ref: string; summary?: string }>;
}

export interface DreamPromoteInput {
  promotedKind: "issue" | "project" | "memory" | "war_room";
  promotedId: string;
}

export interface DreamGenerationResult {
  dream: Dream;
  source: "llm" | "template";
  warning: string | null;
}

export const dreamsApi = {
  list: (companyId: string, opts: { limit?: number } = {}) => {
    const params = new URLSearchParams();
    if (opts.limit) params.set("limit", String(opts.limit));
    const qs = params.toString();
    return api.get<Dream[]>(`/companies/${companyId}/dreams${qs ? `?${qs}` : ""}`);
  },
  capture: (companyId: string, input: DreamCaptureInput) =>
    api.post<Dream>(`/companies/${companyId}/dreams`, input),
  generate: (companyId: string) =>
    api.post<DreamGenerationResult>(`/companies/${companyId}/dreams/generate`, {}),
  promote: (companyId: string, dreamId: string, input: DreamPromoteInput) =>
    api.post<Dream>(`/companies/${companyId}/dreams/${dreamId}/promote`, input),
  dismiss: (companyId: string, dreamId: string) =>
    api.post<Dream>(`/companies/${companyId}/dreams/${dreamId}/dismiss`, {}),
};
