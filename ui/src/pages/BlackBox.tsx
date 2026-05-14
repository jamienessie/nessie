import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { blackBoxApi, type BlackBoxScope } from "../api/blackBox";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import { StackPanel, StackChip } from "@/components/stack";

const SCOPES: BlackBoxScope[] = ["run", "meeting", "hire", "incident", "decision"];
const ACCENT = "#0d0c10";

export default function BlackBox() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [scope, setScope] = useState<BlackBoxScope>("run");
  const [scopeId, setScopeId] = useState("");
  const [submittedScopeId, setSubmittedScopeId] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Black Box" }]);
  }, [setBreadcrumbs]);

  const recordsQuery = useQuery({
    queryKey: ["black-box", scope, submittedScopeId],
    queryFn: () => {
      if (!submittedScopeId) return Promise.resolve({ records: [] });
      return blackBoxApi.listByScope(scope, submittedScopeId);
    },
    enabled: Boolean(submittedScopeId),
  });

  const records = recordsQuery.data?.records ?? [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <StackPanel
        title={
          <span className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            Black Box — forensic snapshot timeline
          </span>
        }
        color={ACCENT}
      >
        <form
          className="flex flex-wrap items-end gap-3 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = scopeId.trim();
            if (trimmed) setSubmittedScopeId(trimmed);
          }}
        >
          <label className="flex flex-col gap-1 text-xs font-mono uppercase tracking-wider text-muted-foreground">
            scope
            <select
              value={scope}
              onChange={(e) => setScope(e.target.value as BlackBoxScope)}
              className="rounded-md border bg-background px-2 py-1 text-xs"
            >
              {SCOPES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs font-mono uppercase tracking-wider text-muted-foreground">
            scope id
            <input
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              placeholder="uuid"
              className="rounded-md border bg-background px-2 py-1 text-xs font-mono"
            />
          </label>
          <Button type="submit" disabled={!scopeId.trim()}>Inspect</Button>
        </form>
      </StackPanel>

      {!submittedScopeId ? (
        <EmptyState icon={Eye} message="Pick a scope and paste an id to load the timeline." />
      ) : recordsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading records…</p>
      ) : records.length === 0 ? (
        <EmptyState icon={Eye} message={`No black-box records for ${scope}/${submittedScopeId}.`} />
      ) : (
        <ul className="flex flex-col gap-2">
          {records.map((rec) => (
            <li key={rec.id}>
              <StackPanel
                color={ACCENT}
                title={
                  <span className="flex items-center gap-2 text-xs">
                    <StackChip>{rec.label ?? "snapshot"}</StackChip>
                    <span className="text-muted-foreground font-mono">
                      {new Date(rec.recordedAt).toLocaleString()}
                    </span>
                  </span>
                }
              >
                <pre className="whitespace-pre-wrap p-3 text-[11px] font-mono">
                  {JSON.stringify(rec.snapshot, null, 2)}
                </pre>
              </StackPanel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
