import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { briefsApi, type BriefPeriod, type ExecutiveBrief } from "../api/briefs";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import { StackPanel, StackButton, StackKpi, StackChip } from "@/components/stack";

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
    <div className="overflow-x-auto p-2">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b-2 border-[#0d0c10]">
            {keys.map((k) => (
              <th key={k} className="px-2 py-1.5 text-left font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b-[1.5px] border-[#0d0c10] last:border-b-0 hover:bg-[#FFF1B8]/30">
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
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <StackKpi label="T1 (subscription)" big={formatCents(costs.T1)} color="#FFB400" />
      <StackKpi label="T2 (paid API)" big={formatCents(costs.T2)} color="#7C5CFF" />
      <StackKpi label="T3 (free/cheap)" big={formatCents(costs.T3)} color="#27D17F" />
      <StackKpi label="Total" big={formatCents(costs.total)} color="#0d0c10" />
    </div>
  );
}

function BriefView({ brief }: { brief: ExecutiveBrief }) {
  return (
    <div className="space-y-4">
      <StackPanel
        title={
          <span className="flex items-center gap-2">
            <span>{brief.period[0].toUpperCase()}{brief.period.slice(1)} brief</span>
            <StackChip color="#FFE6B5">{new Date(brief.range.fromIso).toLocaleDateString()} → {new Date(brief.range.toIso).toLocaleDateString()}</StackChip>
          </span>
        }
        color="#FFB400"
        right={<span className="font-mono text-[10px] font-bold">{brief.sections.length} sections</span>}
      >
        <div className="p-4 space-y-3">
          <div className="stack-mono-label">Cost summary</div>
          <CostSummary costs={brief.costSummary} />
        </div>
      </StackPanel>

      {brief.sections.map((section, i) => (
        <StackPanel
          key={i}
          title={section.heading}
          color="#FFB400"
          right={<span className="font-mono text-[10px] font-bold">{section.rows.length} row{section.rows.length === 1 ? "" : "s"}</span>}
        >
          <SectionTable rows={section.rows} />
        </StackPanel>
      ))}

      {brief.citations.length > 0 && (
        <div className="stack-card p-3 border-dashed" style={{ borderStyle: "dashed" }}>
          <div className="stack-mono-label">Citations</div>
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
            <StackButton
              key={p}
              color={period === p ? "#FFB400" : undefined}
              textColor={period === p ? "#0d0c10" : undefined}
              onClick={() => setPeriod(p)}
            >
              {p}
            </StackButton>
          ))}
        </div>
        <StackButton
          color="#FFB400"
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? "Composing…" : `Compose ${period} brief`}
        </StackButton>
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
