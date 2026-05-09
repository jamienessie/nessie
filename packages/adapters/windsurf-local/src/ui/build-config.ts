import type { CreateConfigValues } from "@nessie/adapter-utils";
import { DEFAULT_WINDSURF_COMMAND, DEFAULT_WINDSURF_MODEL } from "../constants.js";

export function buildWindsurfLocalConfig(values: CreateConfigValues): Record<string, unknown> {
  const ac: Record<string, unknown> = {
    command: values.command?.trim() || DEFAULT_WINDSURF_COMMAND,
    model: values.model?.trim() || DEFAULT_WINDSURF_MODEL,
  };
  if (values.cwd) ac.cwd = values.cwd;
  if (values.instructionsFilePath) ac.instructionsFilePath = values.instructionsFilePath;
  if (values.promptTemplate) ac.promptTemplate = values.promptTemplate;
  if (values.extraArgs) {
    ac.extraArgs = values.extraArgs.split(/\s+/).filter(Boolean);
  }
  if (values.envVars) {
    ac.env = values.envVars;
  }
  if (values.adapterSchemaValues) Object.assign(ac, values.adapterSchemaValues);
  return ac;
}
