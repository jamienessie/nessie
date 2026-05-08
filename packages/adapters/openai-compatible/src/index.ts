import type { AdapterModelProfileDefinition } from "@nessie/adapter-utils";

// Top-level metadata for the openai-compatible adapter.
//
// Targets the Nessie cost-tier proxy at NESSIE_PROXY_URL (default
// http://127.0.0.1:7777/v1). The proxy is the routing spine, so this single
// adapter handles every T2/T3 model the operator has credentials for.
//
// Models below are alias entries the operator picks from in the agent
// config. The proxy resolves the alias to a real upstream call.

export const type = "openai_compatible";
export const label = "OpenAI-compatible (via Nessie proxy)";

export const models = [
  // T2 -- paid API workhorses
  { id: "t2:gpt-4o", label: "GPT-4o (T2 paid API)" },
  { id: "t2:gpt-4o-mini", label: "GPT-4o mini (T2 paid API)" },
  { id: "t2:claude-3-5-sonnet", label: "Claude 3.5 Sonnet (T2 paid API)" },
  // T3 -- free / cheap
  { id: "t3:llama-3.1-70b", label: "Llama 3.1 70B (T3 free/cheap)" },
  { id: "t3:llama-3.1-8b", label: "Llama 3.1 8B (T3 free/cheap)" },
  { id: "t3:mixtral-8x7b", label: "Mixtral 8x7B (T3 free/cheap)" },
];

export const modelProfiles: AdapterModelProfileDefinition[] = [
  {
    key: "cheap",
    label: "Cheap",
    description: "Pin this agent to the cheapest free-tier T3 model.",
    adapterConfig: { model: "t3:llama-3.1-8b" },
    source: "adapter_default",
  },
];

export const agentConfigurationDoc = `# openai_compatible agent configuration

Adapter: openai_compatible

Routes every call through the Nessie cost-tier proxy on NESSIE_PROXY_URL
(default http://127.0.0.1:7777/v1). The 'model' field uses tier-prefixed
aliases (t1:..., t2:..., t3:...) which the proxy resolves to a credential
in the matching pool.

Core fields:
- model (string, required): tier-prefixed model alias, e.g. "t3:llama-3.1-70b"
- tier (string, optional): explicit "T1" | "T2" | "T3"; overrides the alias
  prefix on the model. Useful when the agent should be locked to a tier
  regardless of which model the operator picks.
- systemPrompt (string, optional): system message prepended to each call
- temperature (number, optional): 0..2
- maxTokens (number, optional): output token cap
- proxyUrl (string, optional): override the proxy base URL
- operatorTriggered (boolean, optional): set X-Nessie-Operator-Triggered=true
  to bypass Conservative-mode T1 gating. Only meaningful for T1.

Notes:
- This adapter does NOT spawn a subprocess. It makes a single HTTP call
  per heartbeat invocation. Skills, worktrees, and runtime services are
  surfaced to the agent via the system prompt rather than env vars.
- For real coding work, prefer claude_local or codex_local. This adapter
  is intended for short-lived T2/T3 generations: triage, summarization,
  classification, simple Q&A.
`;
