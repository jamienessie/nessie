import type { AdapterConfigFieldsProps } from "../types";
import {
  Field,
  DraftInput,
} from "../../components/agent-config-primitives";

const inputClass =
  "w-full rounded-md border border-border px-2.5 py-1.5 bg-transparent outline-none text-sm font-mono placeholder:text-muted-foreground/40";

const deploymentHint =
  "Azure deployment name from Azure AI Foundry (e.g. \"o4-mini\", \"gpt-4o\"). This is the name you chose when deploying the model — NOT the OpenAI model id.";

export function AzureOpenaiConfigFields({
  isCreate,
  values,
  set,
  config,
  eff,
  mark,
}: AdapterConfigFieldsProps) {
  const currentDeployment = isCreate
    ? String(values!.model ?? "")
    : eff("adapterConfig", "model", String(config.model ?? config.deployment ?? ""));

  return (
    <Field label="Azure deployment name" hint={deploymentHint}>
      <DraftInput
        value={currentDeployment}
        onCommit={(v) =>
          isCreate
            ? set!({ model: v })
            : mark("adapterConfig", "model", v || undefined)
        }
        immediate
        className={inputClass}
        placeholder="e.g. o4-mini"
      />
    </Field>
  );
}
