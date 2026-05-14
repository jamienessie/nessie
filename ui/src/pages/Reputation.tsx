import { useEffect, useMemo } from "react";
import { useParams } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { Award } from "lucide-react";
import { reputationApi, type ReputationEvent } from "../api/reputation";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { StackPanel, StackChip } from "@/components/stack";
import { AgentLabel } from "../components/AgentLabel";

const ACCENT = "#FFB400";

function summarizeByDimension(events: ReputationEvent[]): Array<{ dimension: string; total: number; count: number }> {
  const map = new Map<string, { total: number; count: number }>();
  for (const e of events) {
    const cur = map.get(e.dimension) ?? { total: 0, count: 0 };
    cur.total += e.delta;
    cur.count += 1;
    map.set(e.dimension, cur);
  }
  return Array.from(map.entries())
    .map(([dimension, agg]) => ({ dimension, ...agg }))
    .sort((a, b) => b.total - a.total);
}

export default function Reputation() {
  const { agentId } = useParams<{ agentId: string }>();
  const { selectedCompanyId: companyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  useEffect(() => {
    setBreadcrumbs([{ label: "Reputation" }]);
  }, [setBreadcrumbs]);

  const eventsQuery = useQuery({
    queryKey: ["reputation", agentId],
    queryFn: () => (agentId ? reputationApi.listEvents(agentId) : Promise.resolve({ events: [] })),
    enabled: Boolean(agentId),
  });

  const agentsQuery = useQuery({
    queryKey: ["reputation-agent", companyId],
    queryFn: () => (companyId ? agentsApi.list(companyId) : Promise.resolve([])),
    enabled: Boolean(companyId),
  });

  const events: ReputationEvent[] = eventsQuery.data?.events ?? [];
  const agent = (agentsQuery.data ?? []).find((a) => a.id === agentId) ?? null;
  const summary = useMemo(() => summarizeByDimension(events), [events]);
  const aggregateScore = useMemo(
    () => Math.max(0, Math.min(100, 50 + events.reduce((acc, e) => acc + e.delta, 0))),
    [events],
  );

  return (
    <div className="flex flex-col gap-4 p-4">
      <StackPanel
        title={
          <span className="flex items-center gap-2">
            <Award className="h-4 w-4" />
            Reputation
            {agent ? (
              <span className="ml-2">
                <AgentLabel agent={agent} showRole size="sm" />
              </span>
            ) : null}
          </span>
        }
        color={ACCENT}
      >
        <div className="flex flex-wrap gap-3 p-3">
          <div className="rounded-md border bg-background px-3 py-2">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">aggregate</div>
            <div className="text-2xl font-bold">{aggregateScore}</div>
          </div>
          {summary.map((row) => (
            <div key={row.dimension} className="rounded-md border bg-background px-3 py-2 min-w-[140px]">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">{row.dimension}</div>
              <div className="text-base font-medium">
                {row.total > 0 ? `+${row.total}` : row.total} <span className="text-muted-foreground text-xs">({row.count})</span>
              </div>
            </div>
          ))}
        </div>
      </StackPanel>

      {eventsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading events…</p>
      ) : events.length === 0 ? (
        <EmptyState icon={Award} message="No reputation events for this agent yet." />
      ) : (
        <ul className="flex flex-col gap-2">
          {events.map((evt) => (
            <li key={evt.id}>
              <StackPanel
                color={ACCENT}
                title={
                  <span className="flex items-center gap-2 text-xs">
                    <StackChip>{evt.dimension}</StackChip>
                    <span className={evt.delta >= 0 ? "text-emerald-600 font-medium" : "text-rose-600 font-medium"}>
                      {evt.delta > 0 ? `+${evt.delta}` : evt.delta}
                    </span>
                    <span className="text-muted-foreground font-mono">{new Date(evt.occurredAt).toLocaleString()}</span>
                  </span>
                }
              >
                <p className="p-3 text-sm">{evt.reason}</p>
              </StackPanel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
