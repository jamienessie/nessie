import type { AdapterConfigFieldsProps } from "../types";

export function GeminiCompatibleConfigFields(_props: AdapterConfigFieldsProps) {
  return (
    <div className="space-y-2">
      <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        Google Gemini reads <code>GEMINI_API_KEY</code> (or <code>GOOGLE_API_KEY</code>) from the
        agent Environment variables or the host environment. Get a free key at{" "}
        <a
          href="https://aistudio.google.com/apikey"
          target="_blank"
          rel="noreferrer"
          className="underline hover:text-foreground"
        >
          aistudio.google.com/apikey
        </a>
        .
      </div>
      <div className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
        The model picker is <strong>filtered to free-tier models only</strong> (Flash variants).
        Pro / Ultra / Vision / Image / Audio models are excluded — these have no free quota or a
        very small one. Runtime also enforces the filter, so a stored config pointing at a
        non-free model will be refused.
      </div>
    </div>
  );
}
