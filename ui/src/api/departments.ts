import { api } from "./client";

// Mirrors the row shape returned by `services/departments.ts`. Server
// schema lives in `packages/db/src/schema/departments.ts`. We
// intentionally don't pull from @nessie/shared because the trust-layer /
// HR / departments tables are server-only types in v1.
export interface Department {
  id: string;
  companyId: string;
  key: string;
  name: string;
  color: string; // oklch literal
  mission: string;
  defaultPreferredTier: "T1" | "T2" | "T3";
  defaultBudgetMonthlyCents: number;
  allowedTools: string[];
  qualityStandards: string[];
  scorecardTemplate: Array<{ criterion: string; weight: number; description?: string }>;
  createdAt: string;
  updatedAt: string;
}

export const departmentsApi = {
  list: (companyId: string) =>
    api.get<{ departments: Department[] }>(
      `/departments?companyId=${encodeURIComponent(companyId)}`,
    ),
  seed: (companyId: string) =>
    api.post<{ inserted: number; existing: number }>(
      `/departments/seed?companyId=${encodeURIComponent(companyId)}`,
      {},
    ),
};
