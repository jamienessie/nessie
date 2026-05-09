import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { briefsApi, type BriefPeriod, type ExecutiveBrief } from "../api/briefs";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";

const PERIODS: BriefPeriod[] = ["daily", "weekly", "monthly"];

function formatCents(cents: number): string {
  if (cents === 0) return "$0";
  return `$${(cents / 100).toFixed(2)}`;
}

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
    return <p className="text-xs text-muted-foreground italic px-3 py-2">Nothing in window.</p>;
  }
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

function CostSummary({ costs }: { costs: ExecutiveBrief["costSummary"] }) {
  const tile = (label: string, cents: number, tone: string) => (
    <div className="border border-border p-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>{formatCents(cents)}</div>
    </div>
  );
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {tile("T1 (subscription)", costs.T1, "text-amber-600 dark:text-amber-400")}
      {tile("T2 (paid API)", costs.T2, "text-indigo-600 dark:text-indigo-400")}
      {tile("T3 (free/cheap)", costs.T3, "text-emerald-600 dark:text-emerald-400")}
      {tile("Total", costs.total, "")}
    </div>
  );
}

function BriefView({ brief }: { brief: ExecutiveBrief }) {
  return (
    <div className="space-y-4">
      <div className="border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">
            {brief.period[0].toUpperCase()}{brief.period.slice(1)} brief
          </h2>
          <code className="text-[10px] font-mono text-muted-foreground">
            {new Date(brief.range.fromIso).toLocaleString()} → {new Date(brief.range.toIso).toLocaleString()}
          </code>
        </div>
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Cost summary</div>
          <div className="mt-2"><CostSummary costs={brief.costSummary} /></div>
        </div>
      </div>

      {brief.sections.map((section, i) => (
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

      {brief.citations.length > 0 && (
        <div className="border border-dashed border-border p-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Citations
          </div>
          <ul className="mt-1 space-y-0.5">
            {brief.citations.map((c, i) => (
              <li key={i} className="font-mono text-[11px] text-muted-foreground">{c}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function Briefs() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [period, setPeriod] = useState<BriefPeriod>("daily");
  const [brief, setBrief] = useState<ExecutiveBrief | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Executive Briefs" }]);
  }, [setBreadcrumbs]);

  const mutation = useMutation({
    mutationFn: () => briefsApi.compose(selectedCompanyId!, period),
    onSuccess: (res) => setBrief(res.brief),
  });

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a company first.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1">
          {PERIODS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPeriod(p)}
              className={`border px-2 py-1 text-[11px] uppercase tracking-wider ${
                period === p
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending}>
          {mutation.isPending ? "Composing…" : `Compose ${period} brief`}
        </Button>
      </div>

      {mutation.error && (
        <p className="text-sm text-destructive">
          {mutation.error instanceof Error ? mutation.error.message : "Failed"}
        </p>
      )}

      {!brief && !mutation.isPending && (
        <EmptyState
          icon={ScrollText}
          message="Compose a brief to see what shipped, what broke, what got expensive, who struggled, and what's next."
          action="Compose now"
          onAction={() => mutation.mutate()}
        />
      )}

      {brief && <BriefView brief={brief} />}
    </div>
  );
}
