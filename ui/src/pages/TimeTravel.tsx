import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { timeTravelApi, type TimeTravelActivityRow, type TimeTravelSnapshotRow } from "../api/timeTravel";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { StackPanel, StackChip } from "@/components/stack";

const ACCENT = "#0d0c10";

function isoLocal(date: Date): string {
  // Trim seconds + zone for a datetime-local input.
  const pad = (n: number) => `${n}`.padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function TimeTravel() {
  const { selectedCompanyId: companyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [pickedAt, setPickedAt] = useState<string>(() => isoLocal(new Date()));

  useEffect(() => {
    setBreadcrumbs([{ label: "Time Travel" }]);
  }, [setBreadcrumbs]);

  const at = useMemo(() => {
    const d = new Date(pickedAt);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [pickedAt]);

  const snapshotQuery = useQuery({
    queryKey: ["time-travel", companyId, at?.toISOString()],
    queryFn: () => {
      if (!companyId || !at) return Promise.resolve(null);
      return timeTravelApi.snapshot(companyId, { at: at.toISOString(), limit: 200 });
    },
    enabled: Boolean(companyId && at),
  });

  return (
    <div className="flex flex-col gap-4 p-4">
      <StackPanel
        color={ACCENT}
        title={
          <span className="flex items-center gap-2">
            <History className="h-4 w-4" />
            Time Travel Inspector
          </span>
        }
      >
        <div className="flex flex-wrap items-center gap-3 p-3 text-xs">
          <label className="flex items-center gap-2">
            <span className="font-mono uppercase tracking-wider text-muted-foreground">
              show state at
            </span>
            <input
              type="datetime-local"
              value={pickedAt}
              onChange={(e) => setPickedAt(e.target.value)}
              className="rounded-md border bg-background px-2 py-1.5 font-mono text-[11px]"
            />
          </label>
          <button
            type="button"
            onClick={() => setPickedAt(isoLocal(new Date()))}
            className="rounded-md border bg-muted px-2 py-1 text-[11px]"
          >
            now
          </button>
          <button
            type="button"
            onClick={() => {
              const d = new Date();
              d.setHours(d.getHours() - 1);
              setPickedAt(isoLocal(d));
            }}
            className="rounded-md border bg-muted px-2 py-1 text-[11px]"
          >
            -1h
          </button>
          <button
            type="button"
            onClick={() => {
              const d = new Date();
              d.setDate(d.getDate() - 1);
              setPickedAt(isoLocal(d));
            }}
            className="rounded-md border bg-muted px-2 py-1 text-[11px]"
          >
            -1d
          </button>
        </div>
      </StackPanel>

      {snapshotQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Reconstructing…</p>
      ) : !snapshotQuery.data ? (
        <EmptyState icon={History} message="Pick a moment in the past to inspect." />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <StackPanel color={ACCENT} title={<span>Activity (latest first)</span>}>
            {snapshotQuery.data.activity.length === 0 ? (
              <EmptyState icon={History} message="No activity at or before that moment." />
            ) : (
              <ul className="flex flex-col gap-1 p-2 text-xs">
                {snapshotQuery.data.activity.map((row: TimeTravelActivityRow) => (
                  <li key={row.id} className="flex flex-col gap-1 rounded-md border bg-background p-2">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="font-mono">{new Date(row.createdAt).toLocaleString()}</span>
                      <StackChip color="#cbd5e1">{row.actorType}</StackChip>
                      <span className="font-mono uppercase tracking-wider">{row.action}</span>
                    </div>
                    <div className="text-[11px]">
                      <span className="font-mono text-muted-foreground">{row.entityType}</span>
                      <span className="ml-2 font-mono">{row.entityId.slice(0, 8)}</span>
                    </div>
                    {row.details ? (
                      <pre className="whitespace-pre-wrap rounded-md bg-muted/30 p-1.5 text-[10px] font-mono">
                        {JSON.stringify(row.details, null, 2)}
                      </pre>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </StackPanel>

          <StackPanel color={ACCENT} title={<span>Latest snapshot per scope</span>}>
            {snapshotQuery.data.snapshots.length === 0 ? (
              <EmptyState icon={History} message="No black box snapshots at or before that moment." />
            ) : (
              <ul className="flex flex-col gap-1 p-2 text-xs">
                {snapshotQuery.data.snapshots.map((row: TimeTravelSnapshotRow) => (
                  <li key={row.id} className="flex flex-col gap-1 rounded-md border bg-background p-2">
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <StackChip color="#cbd5e1">{row.scope}</StackChip>
                      <span className="font-mono">{row.scopeId.slice(0, 8)}</span>
                      <span className="font-mono">{new Date(row.recordedAt).toLocaleString()}</span>
                    </div>
                    {row.label ? (
                      <div className="text-[11px] font-mono">{row.label}</div>
                    ) : null}
                    <pre className="whitespace-pre-wrap rounded-md bg-muted/30 p-1.5 text-[10px] font-mono">
                      {JSON.stringify(row.snapshot, null, 2)}
                    </pre>
                  </li>
                ))}
              </ul>
            )}
          </StackPanel>
        </div>
      )}
    </div>
  );
}
