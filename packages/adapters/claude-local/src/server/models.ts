import type { AdapterModel } from "@nessie/adapter-utils";
import { models as DIRECT_MODELS } from "../index.js";

/** AWS Bedrock model IDs - region-qualified identifiers required by the Bedrock API. */
const BEDROCK_MODELS: AdapterModel[] = [
  { id: "us.anthropic.claude-opus-4-6-v1", label: "Bedrock Opus 4.6" },
  { id: "us.anthropic.claude-sonnet-4-5-20250929-v2:0", label: "Bedrock Sonnet 4.5" },
  { id: "us.anthropic.claude-haiku-4-5-20251001-v1:0", label: "Bedrock Haiku 4.5" },
];

type AnthropicModelsResponse = {
  data?: Array<{
    id?: unknown;
    display_name?: unknown;
    hidden?: unknown;
  }>;
};

function dedupeModels(models: AdapterModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const deduped: AdapterModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push({ id, label: model.label.trim() || id });
  }
  return deduped;
}

function isBedrockEnv(): boolean {
  return (
    process.env.CLAUDE_CODE_USE_BEDROCK === "1" ||
    process.env.CLAUDE_CODE_USE_BEDROCK === "true" ||
    (typeof process.env.ANTHROPIC_BEDROCK_BASE_URL === "string" &&
      process.env.ANTHROPIC_BEDROCK_BASE_URL.trim().length > 0)
  );
}

/**
 * Return the model list appropriate for the current auth mode.
 * When Bedrock env vars are detected, returns Bedrock-native model IDs.
 * When Anthropic API auth is available, discovers live models from the API.
 * Otherwise returns the local built-in direct model set.
 */
export async function listClaudeModels(): Promise<AdapterModel[]> {
  if (isBedrockEnv()) {
    return BEDROCK_MODELS;
  }

  const apiKey = typeof process.env.ANTHROPIC_API_KEY === "string" ? process.env.ANTHROPIC_API_KEY.trim() : "";
  if (!apiKey) {
    return DIRECT_MODELS;
  }

  const response = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
  });

  if (!response.ok) {
    throw new Error(`Anthropic model discovery failed with HTTP ${response.status}.`);
  }

  const payload = (await response.json()) as AnthropicModelsResponse;
  const discovered = Array.isArray(payload.data)
    ? payload.data.flatMap((entry) => {
        if (typeof entry !== "object" || entry === null) return [];
        if ((entry as { hidden?: unknown }).hidden === true) return [];
        const id = typeof (entry as { id?: unknown }).id === "string" ? (entry as { id: string }).id.trim() : "";
        if (!id) return [];
        const label = typeof (entry as { display_name?: unknown }).display_name === "string"
          ? (entry as { display_name: string }).display_name.trim()
          : "";
        return [{ id, label: label || id }];
      })
    : [];

  const deduped = dedupeModels(discovered);
  return deduped.length > 0 ? deduped : DIRECT_MODELS;
}

/** Check whether a model ID is a Bedrock-native identifier (not an Anthropic API short name). */
/** Bedrock model IDs use region-qualified prefixes (e.g. us.anthropic.*, eu.anthropic.*) or ARNs. */
export function isBedrockModelId(model: string): boolean {
  return /^\w+\.anthropic\./.test(model) || model.startsWith("arn:aws:bedrock:");
}
