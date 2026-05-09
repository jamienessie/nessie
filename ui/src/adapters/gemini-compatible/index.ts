import type { UIAdapterModule } from "../types";
import { buildGeminiCompatibleConfig } from "./build-config";
import { GeminiCompatibleConfigFields } from "./config-fields";
import { parseProcessStdoutLine } from "../process/parse-stdout";

// Gemini's OpenAI-compatible endpoint returns a single JSON response per
// call, not a stream of stdout lines, so there's no special parser to
// pick from — fall back to the generic process parser the way openrouter
// does.

export const geminiCompatibleUIAdapter: UIAdapterModule = {
  type: "gemini_compatible",
  label: "Google Gemini",
  parseStdoutLine: parseProcessStdoutLine,
  ConfigFields: GeminiCompatibleConfigFields,
  buildAdapterConfig: buildGeminiCompatibleConfig,
};
