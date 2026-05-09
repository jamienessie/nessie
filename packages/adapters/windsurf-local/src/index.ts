import type { AdapterModelProfileDefinition, ServerAdapterModule } from "@nessie/adapter-utils";
import { execute } from "./server/execute.js";
import { testEnvironment } from "./server/test.js";
import { getConfigSchema } from "./server/config-schema.js";
import { listWindsurfSkills, syncWindsurfSkills } from "./server/skills.js";
import { sessionCodec } from "./server/session-codec.js";
import { resolveWindsurfCommand } from "./server/config.js";
import {
  DEFAULT_WINDSURF_COMMAND,
  DEFAULT_WINDSURF_MODEL,
  label as adapterLabel,
  models,
  type as adapterType,
} from "./constants.js";

export const type = adapterType;
export const label = adapterLabel;
export { DEFAULT_WINDSURF_COMMAND, DEFAULT_WINDSURF_MODEL, models } from "./constants.js";

export const modelProfiles: AdapterModelProfileDefinition[] = [
  {
    key: "cheap",
    label: "Cheap",
    description: "Use Windsurf/Devin's SWE fast lane for cost-sensitive work.",
    adapterConfig: {
      model: DEFAULT_WINDSURF_MODEL,
    },
    source: "adapter_default",
  },
];

export const sessionManagement = {
  supportsSessionResume: true,
  nativeContextManagement: "confirmed" as const,
  defaultSessionCompaction: {
    enabled: true,
    maxSessionRuns: 0,
    maxRawInputTokens: 0,
    maxSessionAgeHours: 0,
  },
};

export const agentConfigurationDoc = `# windsurf_local agent configuration

Adapter: windsurf_local

Use when:
- You want Paperclip to run Windsurf's SWE model through Devin for Terminal
- You have installed the "devin" CLI or the Windsurf-bundled Devin for Terminal binary
- You want persistent ACP sessions across Paperclip heartbeats
- You want to use a Windsurf account or WINDSURF_API_KEY token instead of provider API keys

Don't use when:
- The machine cannot run Devin for Terminal
- You need a generic OpenAI/OpenRouter API adapter instead of a local coding-agent runtime
- You only need one-shot shell commands (use process)

Core fields:
- command (string, optional): Devin CLI command. Defaults to "devin".
- agentCommand (string, optional): full ACP command override. Defaults to "<command> acp".
- cwd (string, optional): default absolute working directory fallback for the agent process.
- instructionsFilePath (string, optional): absolute path to markdown instructions prepended to prompts.
- promptTemplate (string, optional): run prompt template.
- model (string, optional): Devin model id. Defaults to "swe-1-6-fast".
- env (object or JSON string, optional): environment variables. Use WINDSURF_API_KEY for token auth.
- timeoutSec (number, optional): run timeout in seconds. Defaults to 0.
- warmHandleIdleMs (number, optional): keep the ACP process warm after successful runs. Defaults to 0.

Authentication:
- Preferred local setup is: devin auth login --force-manual-token-flow
- Alternatively set WINDSURF_API_KEY through Paperclip secret-backed adapter env.

Notes:
- Runs use the ACP server from Devin for Terminal via "devin acp".
- Paperclip injects selected runtime skills into Devin's global skills directory, never into the project checkout.
- The adapter reports provider and biller as "windsurf" while preserving ACPX session persistence internally.
`;

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

export function createServerAdapter(): ServerAdapterModule {
  return {
    type: adapterType,
    execute,
    testEnvironment,
    listSkills: listWindsurfSkills,
    syncSkills: syncWindsurfSkills,
    sessionCodec,
    sessionManagement,
    supportsLocalAgentJwt: true,
    supportsInstructionsBundle: true,
    instructionsPathKey: "instructionsFilePath",
    requiresMaterializedRuntimeSkills: false,
    models,
    listModels: async () => models,
    refreshModels: async () => models,
    modelProfiles,
    listModelProfiles: async () => modelProfiles,
    agentConfigurationDoc,
    getConfigSchema,
    getRuntimeCommandSpec: (config) => {
      const command = resolveWindsurfCommand(config);
      const canSelfInstall = command === DEFAULT_WINDSURF_COMMAND && !hasPathSeparator(command);
      return {
        command,
        detectCommand: command,
        installCommand: canSelfInstall
          ? `if ! command -v ${shellQuote(command)} >/dev/null 2>&1; then curl -fsSL https://cli.devin.ai/install.sh | bash; fi`
          : null,
      };
    },
    detectModel: async () => ({
      model: DEFAULT_WINDSURF_MODEL,
      provider: "windsurf",
      source: "adapter_default",
      candidates: models.map((model) => model.id),
    }),
  };
}

export { execute, testEnvironment, getConfigSchema, sessionCodec };
