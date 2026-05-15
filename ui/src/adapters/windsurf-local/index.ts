import type { UIAdapterModule } from "../types";
import { parseWindsurfStdoutLine, buildWindsurfLocalConfig } from "@nessie/adapter-windsurf-local/ui";
import { WindsurfLocalConfigFields } from "./config-fields";

export const windsurfLocalUIAdapter: UIAdapterModule = {
  type: "windsurf_local",
  label: "Windsurf SWE (local)",
  parseStdoutLine: parseWindsurfStdoutLine,
  ConfigFields: WindsurfLocalConfigFields,
  buildAdapterConfig: buildWindsurfLocalConfig,
};
