import { api } from "./client";

// Agent Behaviors — per-agent toggles for Auto-Router, Pre-Flight,
// Self-Critic, Consensus Mode. Backend: server/src/routes/agent-behaviors.ts.

export interface AgentBehaviors {
  autoRouter: boolean;
  preFlight: boolean;
  selfCritic: boolean;
  consensus: {
    enabled: boolean;
    models: string[];
    judgeModel: string | null;
    taskType: string | null;
  };
}

function qs(params: Record<string, string | undefined>): string {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) usp.set(key, value);
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export const agentBehaviorsApi = {
  get: (agentId: string, companyId: string) =>
    api.get<{ behaviors: AgentBehaviors }>(
      `/agents/${encodeURIComponent(agentId)}/behaviors${qs({ companyId })}`,
    ),
  update: (agentId: string, input: { companyId: string } & Partial<{
    autoRouter: boolean;
    preFlight: boolean;
    selfCritic: boolean;
    consensus: Partial<AgentBehaviors["consensus"]>;
  }>) =>
    api.put<{ behaviors: AgentBehaviors }>(
      `/agents/${encodeURIComponent(agentId)}/behaviors`,
      input,
    ),
};
