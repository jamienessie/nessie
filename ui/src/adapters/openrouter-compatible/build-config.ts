import type { CreateConfigValues } from "@nessie/adapter-utils";

export function buildOpenRouterConfig(values: CreateConfigValues): Record<string, unknown> {
  const model = typeof values.model === "string" ? values.model.trim() : "";
  return model ? { model } : {};
}
