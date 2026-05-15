import { api } from "./client";

export interface GeneratorPreferences {
  budgetMonthlyCents?: number;
  autonomyLevel?: 1 | 2 | 3 | 4 | 5;
  adapterType?: string;
}

export interface GeneratedCompanyManifest {
  companyName: string;
  description: string;
  topLevelGoal: { title: string; description: string };
  agents: Array<{
    slug: string;
    firstName: string;
    lastName: string;
    title: string;
    role: string;
    tier: "T1" | "T2" | "T3";
    reportsToSlug: string | null;
    capabilities: string;
    roleTemplateKey: string;
    departmentKey: string;
  }>;
  starterIssues: Array<{
    title: string;
    description: string;
    assigneeSlug: string;
    priority: "critical" | "high" | "medium" | "low";
  }>;
}

export interface GenerationResult {
  companyId: string;
  companyName: string;
  topLevelGoalId: string | null;
  agents: { id: string; slug: string; name: string; title: string }[];
  issues: { id: string; title: string }[];
  manifest: GeneratedCompanyManifest;
  source: "llm" | "template";
  warning: string | null;
}

export type ManifestPreview = GeneratedCompanyManifest & {
  source: "llm" | "template";
  warning: string | null;
};

export const companyGeneratorApi = {
  preview: (prompt: string) =>
    api.post<ManifestPreview>(`/companies/generate/preview`, { prompt }),
  generate: (prompt: string, preferences: GeneratorPreferences = {}) =>
    api.post<GenerationResult>(`/companies/generate`, { prompt, preferences }),
};
