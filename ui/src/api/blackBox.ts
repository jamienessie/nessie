import { api } from "./client";

// Phase 6 black-box forensic log. Backend at server/src/routes/trust-layer.ts.

export type BlackBoxScope = "run" | "meeting" | "hire" | "incident" | "decision";

export interface BlackBoxRecord {
  id: string;
  scope: BlackBoxScope;
  scopeId: string;
  label: string | null;
  snapshot: Record<string, unknown>;
  recordedAt: string;
}

export const blackBoxApi = {
  listByScope: (scope: BlackBoxScope, scopeId: string) =>
    api.get<{ records: BlackBoxRecord[] }>(
      `/black-box?scope=${encodeURIComponent(scope)}&scopeId=${encodeURIComponent(scopeId)}`,
    ),
};
