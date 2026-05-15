import { api } from "./client";

// Coaching Notes — operator-curated persistent notes per agent.
// Backend: server/src/routes/coaching-notes.ts.

export type CoachingNoteStatus = "active" | "archived";

export interface CoachingNote {
  id: string;
  companyId: string;
  agentId: string;
  body: string;
  status: CoachingNoteStatus;
  position: number;
  authoredByUserId: string | null;
  archivedByUserId: string | null;
  archivedAt: string | null;
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

export const coachingNotesApi = {
  list: (agentId: string, companyId: string, opts?: { includeArchived?: boolean }) =>
    api.get<{ notes: CoachingNote[] }>(
      `/agents/${encodeURIComponent(agentId)}/coaching-notes${qs({
        companyId,
        includeArchived: opts?.includeArchived ? "true" : undefined,
      })}`,
    ),
  create: (agentId: string, input: { companyId: string; body: string; position?: number }) =>
    api.post<{ note: CoachingNote }>(
      `/agents/${encodeURIComponent(agentId)}/coaching-notes`,
      input,
    ),
  archive: (noteId: string, companyId: string) =>
    api.post<{ note: CoachingNote }>(
      `/coaching-notes/${encodeURIComponent(noteId)}/archive${qs({ companyId })}`,
      {},
    ),
};
