import type { AdapterConfigFieldsProps } from "../types";

export function OpenRouterConfigFields(_props: AdapterConfigFieldsProps) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
      OpenRouter reads <code>OPENROUTER_API_KEY</code> from the agent Environment variables or the host
      environment. If model discovery is unavailable, enter the model manually.
    </div>
  );
}
