import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { chiefOfStaffApi, type ChiefResponse } from "../api/chiefOfStaff";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";

const SUGGESTIONS = [
  "What's happening?",
  "What's blocked?",
  "What needs approval?",
  "What's wasting money?",
  "What should happen next?",
  "Which agents are struggling?",
];

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function renderCellValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toLocaleString();
  return JSON.stringify(value);
}

function SectionTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground italic px-3 py-2">Nothing here.</p>;
  }

  // Union of all keys across rows (in row[0] order, then any extras)
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isPlainObject(row)) continue;
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            {keys.map((k) => (
              <th key={k} className="px-2 py-1.5 text-left font-mono uppercase tracking-wider text-[10px]">
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-b-0 hover:bg-accent/30">
              {keys.map((k) => (
                <td key={k} className="px-2 py-1.5 align-top">
                  <span className="font-mono text-[11px]">{renderCellValue(row[k])}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResponseView({ response }: { response: ChiefResponse }) {
  return (
    <div className="space-y-4">
      <div className="border border-border bg-card p-4">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-amber-500" />
          <code className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            intent: {response.intent}
          </code>
        </div>
        <p className="mt-2 text-sm leading-6">{response.summary}</p>
      </div>

      {response.sections.map((section, i) => (
        <div key={i} className="border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {section.heading}
            </h3>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {section.rows.length} row{section.rows.length === 1 ? "" : "s"}
            </span>
          </div>
          <SectionTable rows={section.rows} />
        </div>
      ))}
    </div>
  );
}

export function ChiefOfStaff() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [command, setCommand] = useState("");
  const [response, setResponse] = useState<ChiefResponse | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Chief of Staff" }]);
  }, [setBreadcrumbs]);

  const mutation = useMutation({
    mutationFn: () => chiefOfStaffApi.ask(selectedCompanyId!, command),
    onSuccess: (res) => setResponse(res),
  });

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a company first.</p>;
  }

  return (
    <div className="space-y-4">
      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (command.trim()) mutation.mutate();
        }}
      >
        <textarea
          rows={3}
          placeholder='Ask Nessie. e.g. "what is wasting money?"'
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          className="w-full border border-border bg-background px-3 py-2 text-sm"
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setCommand(s);
                setTimeout(() => mutation.mutate(), 0);
              }}
              className="border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent"
            >
              {s}
            </button>
          ))}
          <div className="ml-auto flex items-center gap-2">
            <Button type="submit" size="sm" disabled={mutation.isPending || !command.trim()}>
              {mutation.isPending ? "Asking…" : "Ask"}
            </Button>
          </div>
        </div>
      </form>

      {mutation.error && (
        <p className="text-sm text-destructive">
          {mutation.error instanceof Error ? mutation.error.message : "Failed"}
        </p>
      )}

      {!response && !mutation.isPending && (
        <EmptyState
          icon={Sparkles}
          message="Ask anything about the company. The Chief of Staff reads across issues, hires, meetings, costs, and the bus."
        />
      )}

      {response && <ResponseView response={response} />}
    </div>
  );
}
