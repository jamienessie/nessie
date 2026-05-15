import type { AdapterModelProfileDefinition } from "@nessie/adapter-utils";

export const type = "opencode_local";
export const label = "OpenCode (local)";

export const SANDBOX_INSTALL_COMMAND = "npm install -g opencode-ai";

export const DEFAULT_OPENCODE_LOCAL_MODEL = "opencode/big-pickle";

export function isValidOpenCodeModelId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  const slashIndex = trimmed.indexOf("/");
  return Boolean(trimmed) && slashIndex > 0 && slashIndex !== trimmed.length - 1;
}

// Catalog mirrors the IDs exposed by the locally-installed OpenCode CLI
// (`opencode models`). The three buckets the user works in are pulled out
// and labelled; the rest of OpenCode's registry stays reachable via the
// dynamic discovery path. Bucket label prefix surfaces the source in any
// picker without needing to extend the AdapterModel type.
export const models: Array<{ id: string; label: string }> = [
  // --- OpenCode Zen (free) ---
  { id: "opencode/big-pickle", label: "OpenCode Zen (free) — Big Pickle" },
  { id: "opencode/deepseek-v4-flash-free", label: "OpenCode Zen (free) — DeepSeek V4 Flash Free" },
  { id: "opencode/minimax-m2.5-free", label: "OpenCode Zen (free) — MiniMax M2.5 Free" },
  { id: "opencode/nemotron-3-super-free", label: "OpenCode Zen (free) — Nemotron 3 Super Free" },
  { id: "opencode/ring-2.6-1t-free", label: "OpenCode Zen (free) — Ring 2.6 1T Free" },

  // --- OpenRouter (free) — every :free model OpenCode currently exposes ---
  { id: "openrouter/arcee-ai/trinity-large-preview:free", label: "OpenRouter (free) — Arcee AI: Trinity Large Preview" },
  { id: "openrouter/cognitivecomputations/dolphin-mistral-24b-venice-edition:free", label: "OpenRouter (free) — Venice: Uncensored (Dolphin Mistral 24B)" },
  { id: "openrouter/google/gemma-3-4b-it:free", label: "OpenRouter (free) — Google Gemma 3 4B" },
  { id: "openrouter/google/gemma-3-12b-it:free", label: "OpenRouter (free) — Google Gemma 3 12B" },
  { id: "openrouter/google/gemma-3-27b-it:free", label: "OpenRouter (free) — Google Gemma 3 27B" },
  { id: "openrouter/google/gemma-3n-e2b-it:free", label: "OpenRouter (free) — Google Gemma 3n E2B" },
  { id: "openrouter/google/gemma-3n-e4b-it:free", label: "OpenRouter (free) — Google Gemma 3n E4B" },
  { id: "openrouter/google/gemma-4-26b-a4b-it:free", label: "OpenRouter (free) — Google Gemma 4 26B A4B" },
  { id: "openrouter/google/gemma-4-31b-it:free", label: "OpenRouter (free) — Google Gemma 4 31B" },
  { id: "openrouter/liquid/lfm-2.5-1.2b-instruct:free", label: "OpenRouter (free) — LiquidAI LFM2.5 1.2B Instruct" },
  { id: "openrouter/liquid/lfm-2.5-1.2b-thinking:free", label: "OpenRouter (free) — LiquidAI LFM2.5 1.2B Thinking" },
  { id: "openrouter/meta-llama/llama-3.2-3b-instruct:free", label: "OpenRouter (free) — Meta Llama 3.2 3B Instruct" },
  { id: "openrouter/meta-llama/llama-3.3-70b-instruct:free", label: "OpenRouter (free) — Meta Llama 3.3 70B Instruct" },
  { id: "openrouter/minimax/minimax-m2.5:free", label: "OpenRouter (free) — MiniMax M2.5" },
  { id: "openrouter/nousresearch/hermes-3-llama-3.1-405b:free", label: "OpenRouter (free) — Nous Hermes 3 405B Instruct" },
  { id: "openrouter/nvidia/nemotron-3-nano-30b-a3b:free", label: "OpenRouter (free) — NVIDIA Nemotron 3 Nano 30B A3B" },
  { id: "openrouter/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free", label: "OpenRouter (free) — NVIDIA Nemotron 3 Nano Omni Reasoning" },
  { id: "openrouter/nvidia/nemotron-3-super-120b-a12b:free", label: "OpenRouter (free) — NVIDIA Nemotron 3 Super 120B" },
  { id: "openrouter/nvidia/nemotron-nano-12b-v2-vl:free", label: "OpenRouter (free) — NVIDIA Nemotron Nano 12B v2 VL" },
  { id: "openrouter/nvidia/nemotron-nano-9b-v2:free", label: "OpenRouter (free) — NVIDIA Nemotron Nano 9B v2" },
  { id: "openrouter/openai/gpt-oss-120b:free", label: "OpenRouter (free) — OpenAI gpt-oss 120B" },
  { id: "openrouter/openai/gpt-oss-20b:free", label: "OpenRouter (free) — OpenAI gpt-oss 20B" },
  { id: "openrouter/poolside/laguna-m.1:free", label: "OpenRouter (free) — Poolside Laguna M.1" },
  { id: "openrouter/poolside/laguna-xs.2:free", label: "OpenRouter (free) — Poolside Laguna XS.2" },
  { id: "openrouter/z-ai/glm-4.5-air:free", label: "OpenRouter (free) — GLM 4.5 Air" },

  // --- OpenCode Go ---
  { id: "opencode-go/glm-5.1", label: "OpenCode Go — GLM-5.1" },
  { id: "opencode-go/glm-5", label: "OpenCode Go — GLM-5" },
  { id: "opencode-go/kimi-k2.5", label: "OpenCode Go — Kimi K2.5" },
  { id: "opencode-go/kimi-k2.6", label: "OpenCode Go — Kimi K2.6" },
  { id: "opencode-go/mimo-v2.5", label: "OpenCode Go — MiMo-V2.5" },
  { id: "opencode-go/mimo-v2.5-pro", label: "OpenCode Go — MiMo-V2.5-Pro" },
  { id: "opencode-go/minimax-m2.5", label: "OpenCode Go — MiniMax M2.5" },
  { id: "opencode-go/minimax-m2.7", label: "OpenCode Go — MiniMax M2.7" },
  { id: "opencode-go/qwen3.5-plus", label: "OpenCode Go — Qwen3.5 Plus" },
  { id: "opencode-go/qwen3.6-plus", label: "OpenCode Go — Qwen3.6 Plus" },
  { id: "opencode-go/deepseek-v4-pro", label: "OpenCode Go — DeepSeek V4 Pro" },
  { id: "opencode-go/deepseek-v4-flash", label: "OpenCode Go — DeepSeek V4 Flash" },
];

export const modelProfiles: AdapterModelProfileDefinition[] = [
  {
    key: "cheap",
    label: "Cheap",
    description: "OpenCode Zen Big Pickle — free flagship Zen model.",
    adapterConfig: {
      model: "opencode/big-pickle",
    },
    source: "adapter_default",
  },
];

export const agentConfigurationDoc = `# opencode_local agent configuration

Adapter: opencode_local

Use when:
- You want Paperclip to run OpenCode locally as the agent runtime
- You want provider/model routing in OpenCode format (provider/model)
- You want OpenCode session resume across heartbeats via --session

Don't use when:
- You need webhook-style external invocation (use openclaw_gateway or http)
- You only need one-shot shell commands (use process)
- OpenCode CLI is not installed on the machine

Core fields:
- cwd (string, optional): default absolute working directory fallback for the agent process (created if missing when possible)
- instructionsFilePath (string, optional): absolute path to a markdown instructions file prepended to the run prompt
- model (string, required): OpenCode model id in provider/model format (for example anthropic/claude-sonnet-4-5)
- variant (string, optional): provider-specific reasoning/profile variant passed as --variant (for example minimal|low|medium|high|xhigh|max)
- dangerouslySkipPermissions (boolean, optional): inject a runtime OpenCode config that allows \`external_directory\` access without interactive prompts; defaults to true for unattended Paperclip runs
- promptTemplate (string, optional): run prompt template
- command (string, optional): defaults to "opencode"
- extraArgs (string[], optional): additional CLI args
- env (object, optional): KEY=VALUE environment variables

Operational fields:
- timeoutSec (number, optional): run timeout in seconds
- graceSec (number, optional): SIGTERM grace period in seconds

Notes:
- OpenCode supports multiple providers and models. Use \
  \`opencode models\` to list available options in provider/model format.
- The Paperclip-shipped catalog groups models into three buckets, with the \
  bucket prefix encoded in each picker label: \`OpenCode Zen (free) — …\`, \
  \`OpenRouter (free) — …\`, and \`OpenCode Go — …\`. The underlying \`id\` \
  is still the raw provider/model string OpenCode expects.
- Paperclip requires an explicit \`model\` value for \`opencode_local\` agents.
- Runs are executed with: opencode run --format json ...
- Sessions are resumed with --session when stored session cwd matches current cwd.
- The adapter sets OPENCODE_DISABLE_PROJECT_CONFIG=true to prevent OpenCode from \
  writing an opencode.json config file into the project working directory. Model \
  selection is passed via the --model CLI flag instead.
- When \`dangerouslySkipPermissions\` is enabled, Paperclip injects a temporary \
  runtime config with \`permission.external_directory=allow\` so headless runs do \
  not stall on approval prompts.
`;
