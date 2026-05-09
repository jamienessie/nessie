import type { AdapterConfigSchema } from "@nessie/adapter-utils";
import { DEFAULT_WINDSURF_COMMAND, DEFAULT_WINDSURF_MODEL, models } from "../constants.js";

export function getConfigSchema(): AdapterConfigSchema {
  return {
    fields: [
      {
        key: "command",
        label: "Devin command",
        type: "text",
        default: DEFAULT_WINDSURF_COMMAND,
        hint: "Command used to start Devin for Terminal. The adapter runs it as `<command> acp`.",
      },
      {
        key: "agentCommand",
        label: "ACP command override",
        type: "text",
        hint: "Optional full ACP server command. Leave blank to use `<Devin command> acp`.",
      },
      {
        key: "model",
        label: "Model",
        type: "combobox",
        default: DEFAULT_WINDSURF_MODEL,
        options: models.map((model) => ({ value: model.id, label: model.label })),
        hint: "Defaults to SWE 1.6 Fast. You can type any model accepted by `devin --model`.",
      },
      {
        key: "cwd",
        label: "Working directory",
        type: "text",
        hint: "Absolute fallback directory. Paperclip execution workspaces can override this at runtime.",
      },
      {
        key: "instructionsFilePath",
        label: "Instructions file",
        type: "text",
        hint: "Optional markdown instructions file prepended to the run prompt.",
      },
      {
        key: "promptTemplate",
        label: "Prompt template",
        type: "textarea",
        hint: "Optional run prompt template. Leave blank for Paperclip's default agent prompt.",
      },
      {
        key: "env",
        label: "Environment JSON",
        type: "textarea",
        default: "{}",
        hint: "Optional JSON object. Put WINDSURF_API_KEY here via a Paperclip secret binding for token auth.",
      },
      {
        key: "timeoutSec",
        label: "Timeout seconds",
        type: "number",
        default: 0,
      },
      {
        key: "warmHandleIdleMs",
        label: "Warm process idle ms",
        type: "number",
        default: 0,
        hint: "Defaults to 0, closing the ACP process after each run while retaining persistent session state.",
      },
      {
        key: "runHelloProbe",
        label: "Run hello probe",
        type: "toggle",
        default: false,
        hint: "When enabled, Test environment sends a tiny SWE prompt to verify end-to-end auth.",
      },
    ],
  };
}
