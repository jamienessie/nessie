import { api } from "./client";

// Snippet Library — backend: server/src/routes/snippets.ts.

export interface Snippet {
  id: string;
  companyId: string;
  key: string;
  title: string;
  body: string;
  version: number;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SnippetRevision {
  id: string;
  snippetId: string;
  version: number;
  body: string;
  note: string | null;
  snapshotByUserId: string | null;
  createdAt: string;
}

function qs(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export const snippetsApi = {
  list: (companyId: string) =>
    api.get<{ snippets: Snippet[] }>(`/snippets${qs({ companyId })}`),
  get: (key: string, companyId: string) =>
    api.get<{ snippet: Snippet }>(`/snippets/${encodeURIComponent(key)}${qs({ companyId })}`),
  upsert: (key: string, input: { companyId: string; title: string; body: string; note?: string | null }) =>
    api.put<{ snippet: Snippet }>(`/snippets/${encodeURIComponent(key)}`, input),
  listRevisions: (key: string, companyId: string) =>
    api.get<{ revisions: SnippetRevision[] }>(
      `/snippets/${encodeURIComponent(key)}/revisions${qs({ companyId })}`,
    ),
  delete: (key: string, companyId: string) =>
    api.delete<void>(`/snippets/${encodeURIComponent(key)}${qs({ companyId })}`),
};
