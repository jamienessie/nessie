import type { CreateConfigValues } from "@nessie/adapter-utils";

export function buildAzureOpenaiConfig(values: CreateConfigValues): Record<string, unknown> {
  const deployment = typeof values.model === "string" ? values.model.trim() : "";
  return deployment ? { deployment } : {};
}
