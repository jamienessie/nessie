import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wrench, AlertTriangle, Pause, Sparkles } from "lucide-react";
import {
  plugInJanitorApi,
  type JanitorOutage,
  type JanitorReport,
  type PausedAgentRow,
} from "../api/plugInJanitor";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import { queryKeys } from "../lib/queryKeys";

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return "soon";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function triggeredByLabel(value: JanitorReport["triggeredBy"]): string {
  if (value === "manual") return "Manual";
  if (value === "scheduled") return "Scheduled";
  if (value === "auto_on_error") return "Auto-on-error";
  return value;
}

function StatusPill({ status }: { status: JanitorOutage["status"] }) {
  const tone =
    status === "open"
      ? "bg-red-500/15 text-red-700 dark:text-red-400"
      : status === "in_progress"
        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
        : status === "resolved"
          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
          : "bg-muted text-muted-foreground";
  return (
    <span className={`px-1.5 py-0.5 text-[11px] font-mono ${tone}`}>{status}</span>
  );
}

function HeroStrip(props: {
  hankLabel: string;
  hankStatus: string | null;
  lastReport: JanitorReport | null;
  openOutageCount: number;
  pausedCount: number;
  onRun: () => void;
  isRunning: boolean;
}) {
  return (
    <div className="border border-border bg-card">
      <div className="flex flex-wrap items-start gap-4 p-4">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <Wrench className="h-5 w-5 text-amber-500" />
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight">{props.hankLabel}</div>
            <div className="text-[11px] text-muted-foreground">
              {props.hankStatus ?? "not seeded"} · scans every 15 min · free Gemini Flash
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {props.openOutageCount > 0 && (
            <span className="inline-flex items-center gap-1 border border-red-500/40 bg-red-500/10 px-2 py-1 text-[11px] font-mono text-red-700 dark:text-red-400">
              <AlertTriangle className="h-3 w-3" />
              {props.openOutageCount} open outage{props.openOutageCount === 1 ? "" : "s"}
            </span>
          )}
          {props.pausedCount > 0 && (
            <span className="inline-flex items-center gap-1 border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] font-mono text-amber-700 dark:text-amber-400">
              <Pause className="h-3 w-3" />
              {props.pausedCount} paused
            </span>
          )}
          <Button onClick={props.onRun} disabled={props.isRunning} size="sm">
            {props.isRunning ? "Sweeping…" : "Run Now"}
          </Button>
        </div>
      </div>
      {props.lastReport && (
        <div className="grid grid-cols-2 gap-px border-t border-border bg-border md:grid-cols-5">
          <Stat label="Last sweep" value={formatRelative(props.lastReport.startedAt)} />
          <Stat label="Scanned" value={String(props.lastReport.scannedCount)} />
          <Stat label="Healthy" value={String(props.lastReport.healthyCount)} />
          <Stat label="Swapped" value={String(props.lastReport.swappedCount)} />
          <Stat label="Paused" value={String(props.lastReport.pausedCount)} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-card p-3">
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm tabular-nums">{value}</div>
    </div>
  );
}

function OutageRow({
  outage,
  onSelect,
}: {
  outage: JanitorOutage;
  onSelect: (id: string) => void;
}) {
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-accent/30">
      <td className="px-3 py-2 align-top">
        <code className="text-[11px] font-mono">{outage.adapterType}</code>
      </td>
      <td className="px-3 py-2 align-top">
        <code className="text-[11px] font-mono text-red-700 dark:text-red-400">
          {outage.dominantErrorCode}
        </code>
      </td>
      <td className="px-3 py-2 align-top text-xs">{formatRelative(outage.detectedAt)}</td>
      <td className="px-3 py-2 align-top text-xs tabular-nums">{outage.observationCount}</td>
      <td className="px-3 py-2 align-top text-xs">
        {outage.escalatedIssueId ? (
          <code className="text-[11px] font-mono">issue:{outage.escalatedIssueId.slice(0, 8)}</code>
        ) : (
          <span className="italic text-muted-foreground">none</span>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <StatusPill status={outage.status} />
      </td>
      <td className="px-3 py-2 align-top text-right">
        <button
          type="button"
          onClick={() => onSelect(outage.id)}
          className="text-[11px] underline text-muted-foreground hover:text-foreground"
        >
          view
        </button>
      </td>
    </tr>
  );
}

function ReportRow({
  report,
  onSelect,
}: {
  report: JanitorReport;
  onSelect: (id: string) => void;
}) {
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-accent/30">
      <td className="px-3 py-2 align-top text-xs">{formatRelative(report.startedAt)}</td>
      <td className="px-3 py-2 align-top text-xs">{triggeredByLabel(report.triggeredBy)}</td>
      <td className="px-3 py-2 align-top text-xs tabular-nums">{report.scannedCount}</td>
      <td className="px-3 py-2 align-top text-xs tabular-nums">{report.healthyCount}</td>
      <td className="px-3 py-2 align-top text-xs tabular-nums">{report.swappedCount}</td>
      <td className="px-3 py-2 align-top text-xs tabular-nums">{report.pausedCount}</td>
      <td className="px-3 py-2 align-top text-xs tabular-nums">{report.outagesDetectedCount}</td>
      <td className="px-3 py-2 align-top text-right">
        <button
          type="button"
          onClick={() => onSelect(report.id)}
          className="text-[11px] underline text-muted-foreground hover:text-foreground"
        >
          view
        </button>
      </td>
    </tr>
  );
}

function PausedRow({ row }: { row: PausedAgentRow }) {
  const display = `${row.humanFirstName} ${row.humanLastName}`.trim() || row.name;
  const label = row.title ? `${display} · ${row.title}` : display;
  const prior = (row.metadata && typeof row.metadata.janitorPriorBinding === "object"
    ? row.metadata.janitorPriorBinding as { adapterType?: string; model?: string }
    : null);
  return (
    <tr className="border-b border-border last:border-b-0 hover:bg-accent/30">
      <td className="px-3 py-2 align-top text-xs font-medium">{label}</td>
      <td className="px-3 py-2 align-top text-xs">
        {prior ? (
          <code className="text-[11px] font-mono">
            {prior.adapterType ?? "?"}:{prior.model ?? "?"}
          </code>
        ) : (
          <span className="italic text-muted-foreground">unknown</span>
        )}
      </td>
      <td className="px-3 py-2 align-top text-xs text-muted-foreground">{row.pauseReason ?? "—"}</td>
      <td className="px-3 py-2 align-top text-xs">{formatRelative(row.pausedAt)}</td>
    </tr>
  );
}

export function PlugInJanitor() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [selectedOutageId, setSelectedOutageId] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Plug-In Janitor" }]);
  }, [setBreadcrumbs]);

  const identity = useQuery({
    queryKey: queryKeys.plugInJanitor.identity(selectedCompanyId ?? ""),
    queryFn: () => plugInJanitorApi.identity(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const reports = useQuery({
    queryKey: queryKeys.plugInJanitor.reports(selectedCompanyId ?? ""),
    queryFn: () => plugInJanitorApi.reports(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 30_000,
  });

  const openOutages = useQuery({
    queryKey: queryKeys.plugInJanitor.openOutages(selectedCompanyId ?? ""),
    queryFn: () => plugInJanitorApi.outages(selectedCompanyId!, "open"),
    enabled: !!selectedCompanyId,
    refetchInterval: 30_000,
  });

  const pausedAgents = useQuery({
    queryKey: queryKeys.plugInJanitor.pausedAgents(selectedCompanyId ?? ""),
    queryFn: () => plugInJanitorApi.pausedAgents(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 30_000,
  });

  const runMutation = useMutation({
    mutationFn: () => plugInJanitorApi.run(selectedCompanyId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plugInJanitor.reports(selectedCompanyId ?? "") });
      queryClient.invalidateQueries({ queryKey: queryKeys.plugInJanitor.openOutages(selectedCompanyId ?? "") });
      queryClient.invalidateQueries({ queryKey: queryKeys.plugInJanitor.pausedAgents(selectedCompanyId ?? "") });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: (outageId: string) => plugInJanitorApi.resolveOutage(selectedCompanyId!, outageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.plugInJanitor.openOutages(selectedCompanyId ?? "") });
      setSelectedOutageId(null);
    },
  });

  const selectedReport = useMemo(() => {
    if (!selectedReportId) return null;
    return reports.data?.reports.find((r) => r.id === selectedReportId) ?? null;
  }, [reports.data, selectedReportId]);

  const selectedOutage = useMemo(() => {
    if (!selectedOutageId) return null;
    return openOutages.data?.outages.find((o) => o.id === selectedOutageId) ?? null;
  }, [openOutages.data, selectedOutageId]);

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a company first.</p>;
  }
  if (identity.isLoading || reports.isLoading) {
    return <PageSkeleton />;
  }

  const hank = identity.data?.janitor ?? null;
  const hankDisplay = hank
    ? `${hank.humanFirstName} ${hank.humanLastName}`.trim() || hank.name
    : "Hank Brennan";
  const hankLabel = hank?.title ? `${hankDisplay} · ${hank.title}` : `${hankDisplay} · Plug-In Janitor`;

  const lastReport = reports.data?.reports[0] ?? null;
  const openOutageCount = openOutages.data?.outages.length ?? 0;
  const pausedCount = pausedAgents.data?.agents.length ?? 0;

  return (
    <div className="space-y-4">
      <HeroStrip
        hankLabel={hankLabel}
        hankStatus={hank?.status ?? null}
        lastReport={lastReport}
        openOutageCount={openOutageCount}
        pausedCount={pausedCount}
        onRun={() => runMutation.mutate()}
        isRunning={runMutation.isPending}
      />

      {runMutation.error && (
        <p className="text-sm text-destructive">
          {runMutation.error instanceof Error ? runMutation.error.message : "Sweep failed"}
        </p>
      )}

      {!hank && (
        <EmptyState
          icon={Wrench}
          message="Hank hasn't been seeded for this company yet. Restart the server to seed him, or check the Engineering department exists."
        />
      )}

      {openOutageCount > 0 && (
        <Section heading="Open adapter outages" rowCount={openOutageCount}>
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <Th>Adapter</Th>
                <Th>Error code</Th>
                <Th>Detected</Th>
                <Th>Obs.</Th>
                <Th>Issue</Th>
                <Th>Status</Th>
                <Th className="text-right">&nbsp;</Th>
              </tr>
            </thead>
            <tbody>
              {openOutages.data!.outages.map((o) => (
                <OutageRow key={o.id} outage={o} onSelect={setSelectedOutageId} />
              ))}
            </tbody>
          </table>
        </Section>
      )}

      <Section heading="Recent sweep reports" rowCount={reports.data?.reports.length ?? 0}>
        {reports.data && reports.data.reports.length > 0 ? (
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <Th>Started</Th>
                <Th>Trigger</Th>
                <Th>Scanned</Th>
                <Th>Healthy</Th>
                <Th>Swapped</Th>
                <Th>Paused</Th>
                <Th>Outages</Th>
                <Th className="text-right">&nbsp;</Th>
              </tr>
            </thead>
            <tbody>
              {reports.data.reports.map((r) => (
                <ReportRow key={r.id} report={r} onSelect={setSelectedReportId} />
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-xs text-muted-foreground italic px-3 py-2">No sweeps yet.</p>
        )}
      </Section>

      {pausedCount > 0 && (
        <Section heading="Currently paused by Hank" rowCount={pausedCount}>
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <Th>Agent</Th>
                <Th>Prior binding</Th>
                <Th>Reason</Th>
                <Th>Paused</Th>
              </tr>
            </thead>
            <tbody>
              {pausedAgents.data!.agents.map((row) => (
                <PausedRow key={row.id} row={row} />
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {selectedReport && (
        <SidePanel onClose={() => setSelectedReportId(null)} title={`Sweep ${selectedReport.id.slice(0, 8)}`}>
          <ReportDetail report={selectedReport} />
        </SidePanel>
      )}
      {selectedOutage && (
        <SidePanel
          onClose={() => setSelectedOutageId(null)}
          title={`Outage: ${selectedOutage.adapterType}`}
          actions={
            <Button
              size="sm"
              variant="outline"
              onClick={() => resolveMutation.mutate(selectedOutage.id)}
              disabled={resolveMutation.isPending}
            >
              {resolveMutation.isPending ? "Resolving…" : "Mark resolved"}
            </Button>
          }
        >
          <OutageDetail outage={selectedOutage} />
        </SidePanel>
      )}
    </div>
  );
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th className={`px-3 py-1.5 text-left font-mono uppercase tracking-wider text-[10px] ${className ?? ""}`}>
      {children}
    </th>
  );
}

function Section({ heading, rowCount, children }: { heading: string; rowCount: number; children: React.ReactNode }) {
  return (
    <div className="border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{heading}</h3>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {rowCount} row{rowCount === 1 ? "" : "s"}
        </span>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

function SidePanel({
  title,
  children,
  onClose,
  actions,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-background/40">
      <div className="w-full max-w-2xl border-l border-border bg-card overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-border bg-card px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="flex items-center gap-2">
            {actions}
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
        <div className="p-4 space-y-4">{children}</div>
      </div>
    </div>
  );
}

function ReportDetail({ report }: { report: JanitorReport }) {
  return (
    <>
      <div className="border border-border p-3">
        <div className="flex items-center gap-2 mb-2">
          <Sparkles className="h-3 w-3 text-amber-500" />
          <code className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {report.summarySource ?? "no summary"}
          </code>
        </div>
        <p className="text-sm leading-6 whitespace-pre-wrap">{report.summaryProse ?? "(no summary)"}</p>
      </div>

      {report.swaps.length > 0 && (
        <div className="border border-border">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Swaps ({report.swaps.length})
          </div>
          <ul className="divide-y divide-border">
            {report.swaps.map((s) => (
              <li key={s.agentId} className="px-3 py-2 text-xs">
                <div className="font-medium">{s.agentLabel}</div>
                <code className="text-[11px] font-mono text-muted-foreground">
                  {s.from.adapterType}:{s.from.model} → {s.to.adapterType}:{s.to.model}
                </code>
                <div className="text-[11px] text-muted-foreground mt-1">{s.reason}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.pauses.length > 0 && (
        <div className="border border-border">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Pauses ({report.pauses.length})
          </div>
          <ul className="divide-y divide-border">
            {report.pauses.map((p) => (
              <li key={p.agentId} className="px-3 py-2 text-xs">
                <div className="font-medium">{p.agentLabel}</div>
                <code className="text-[11px] font-mono text-muted-foreground">
                  {p.binding.adapterType}:{p.binding.model}
                </code>
                <div className="text-[11px] text-muted-foreground mt-1">{p.reason}</div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function OutageDetail({ outage }: { outage: JanitorOutage }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-3 text-xs">
        <KV label="Adapter" value={outage.adapterType} />
        <KV label="Status" value={outage.status} />
        <KV label="Dominant code" value={outage.dominantErrorCode} />
        <KV label="Detected" value={formatRelative(outage.detectedAt)} />
        <KV label="Observations" value={String(outage.observationCount)} />
        <KV label="Plan source" value={outage.planSource} />
      </div>

      <div className="border border-border">
        <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Plan
        </div>
        <pre className="px-3 py-2 text-[11px] font-mono whitespace-pre-wrap leading-5">{outage.planMarkdown}</pre>
      </div>

      <div className="border border-border">
        <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Failed models ({outage.errorPattern.failedModels.length} of {outage.errorPattern.attempted} attempted)
        </div>
        <div className="px-3 py-2 flex flex-wrap gap-1">
          {outage.errorPattern.failedModels.map((m) => (
            <code key={m} className="border border-border px-1.5 py-0.5 text-[11px] font-mono">
              {m}
            </code>
          ))}
        </div>
      </div>

      {outage.errorPattern.sampleMessages.length > 0 && (
        <div className="border border-border">
          <div className="border-b border-border px-3 py-2 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Sample errors
          </div>
          <ul className="divide-y divide-border">
            {outage.errorPattern.sampleMessages.map((m, i) => (
              <li key={i} className="px-3 py-2 text-[11px] font-mono whitespace-pre-wrap">{m}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      <div className="text-xs font-mono">{value}</div>
    </div>
  );
}
