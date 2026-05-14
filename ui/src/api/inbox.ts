import { api } from "./client";

// Server source: routes/inbox-items.ts + services/inbox-items.ts.
// Phase 7 universal-capture inbox. NOT the same as the existing
// Cockpit /inbox work-list page (which is issues + approvals).

export type InboxKind = "note" | "url" | "file" | "voice" | string;
export type InboxStatus = "captured" | "dismissed" | "saved_as_memory" | "became_issue" | string;

export interface InboxItem {
  id: string;
  companyId: string;
  kind: InboxKind;
  bodyMarkdown: string | null;
  refs: unknown[];
  status: InboxStatus;
  capturedByUserId: string | null;
  triagedAt: string | null;
  triagedNotes: string | null;
  promotedKind: string | null;
  promotedId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CaptureInboxItemInput {
  kind?: InboxKind;
  bodyMarkdown?: string;
  refs?: unknown[];
}

export interface TriageInboxItemInput {
  status: InboxStatus;
  notes?: string;
  promotedKind?: string;
  promotedId?: string;
}

function qs(companyId: string, status?: InboxStatus): string {
  const params = new URLSearchParams({ companyId });
  if (status) params.set("status", status);
  return `?${params.toString()}`;
}

export const inboxApi = {
  list: (companyId: string, status?: InboxStatus) =>
    api.get<{ items: InboxItem[] }>(`/inbox${qs(companyId, status)}`),
  capture: (companyId: string, input: CaptureInboxItemInput) =>
    api.post<{ item: InboxItem }>(`/inbox?companyId=${encodeURIComponent(companyId)}`, input),
  triage: (companyId: string, itemId: string, input: TriageInboxItemInput) =>
    api.post<{ item: InboxItem }>(
      `/inbox/${encodeURIComponent(itemId)}/triage?companyId=${encodeURIComponent(companyId)}`,
      input,
    ),
};
