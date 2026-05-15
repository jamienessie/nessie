import { api } from "./client";
import type { GenerationResult } from "./companyGenerator";

export interface ClipMartEntry {
  slug: string;
  name: string;
  tagline: string;
  authorHandle: string;
  tags: string[];
  prompt: string;
  stats: { agents: number; departments: number; issues: number };
}

export const clipmartApi = {
  list: () => api.get<{ entries: ClipMartEntry[] }>(`/clipmart/catalog`),
  get: (slug: string) => api.get<ClipMartEntry>(`/clipmart/entry/${encodeURIComponent(slug)}`),
  fork: (slug: string) =>
    api.post<GenerationResult>(`/clipmart/fork/${encodeURIComponent(slug)}`, {}),
};
