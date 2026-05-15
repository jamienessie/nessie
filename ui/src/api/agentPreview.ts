import { api } from "./client";

export interface AgentPreview {
  agentId: string;
  configuredModel: string | null;
  resolvedModel: string | null;
  routerSource: "leaderboard" | "configured";
  routerReason: string | null;
  coachingPrefix: string | null;
  configuredSystemPrompt: string | null;
  assembledSystemPrompt: string | null;
  behaviors: {
    autoRouter: boolean;
    preFlight: boolean;
    preFlightOverrideUntil: string | null;
    selfCritic: boolean;
    consensus: { enabled: boolean; models: string[]; judgeModel: string | null };
  };
}

export const agentPreviewApi = {
  fetch: (agentId: string, companyId: string) =>
    api.get<{ preview: AgentPreview }>(
      `/agents/${encodeURIComponent(agentId)}/preview?companyId=${encodeURIComponent(companyId)}`,
    ),
  preflightOverride: (agentId: string, input: { companyId: string; minutes?: number }) =>
    api.post<{ until: string; minutes: number }>(
      `/agents/${encodeURIComponent(agentId)}/preflight-override`,
      input,
    ),
};
