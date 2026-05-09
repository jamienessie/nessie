import type { UIAdapterModule } from "../types";
import { buildOpenRouterConfig } from "./build-config";
import { OpenRouterConfigFields } from "./config-fields";
import { parseProcessStdoutLine } from "../process/parse-stdout";

export const openRouterUIAdapter: UIAdapterModule = {
  type: "openrouter_compatible",
  label: "OpenRouter",
  parseStdoutLine: parseProcessStdoutLine,
  ConfigFields: OpenRouterConfigFields,
  buildAdapterConfig: buildOpenRouterConfig,
};
