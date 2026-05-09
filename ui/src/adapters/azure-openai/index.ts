import type { UIAdapterModule } from "../types";
import { buildAzureOpenaiConfig } from "./build-config";
import { AzureOpenaiConfigFields } from "./config-fields";
import { parseProcessStdoutLine } from "../process/parse-stdout";

export const azureOpenaiUIAdapter: UIAdapterModule = {
  type: "azure_openai",
  label: "Azure OpenAI",
  parseStdoutLine: parseProcessStdoutLine,
  ConfigFields: AzureOpenaiConfigFields,
  buildAdapterConfig: buildAzureOpenaiConfig,
};
