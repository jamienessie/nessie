import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { departmentsApi, type Department } from "../api/departments";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import type { Agent } from "@nessie/shared";

const NO_COMPANY = "__none__";

function formatCents(cents: number): string {
  if (cents === 0) return "$0";
  if (cents < 100) return `${cents}¢`;
  const dollars = cents / 100;
  return dollars >= 100 ? `$${Math.round(dollars).toLocaleString()}` : `$${dollars.toFixed(2)}`;
}

function tierTone(tier: string) {
  if (tier === "T1") return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
  if (tier === "T2") return "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400";
  return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
}

function DepartmentCard({ dept, agents }: { dept: Department; agents: Agent[] }) {
  const swatch = dept.color || "oklch(0.7 0 0)";
  return (
    <div className="border border-border bg-card">
      <div className="flex items-start gap-3 border-b border-border px-4 py-3">
        <div
          aria-hidden
          className="mt-1 h-3 w-3 rounded-sm shrink-0"
          style={{ backgroundColor: swatch, boxShadow: `0 0 12px ${swatch}` }}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold tracking-tight">{dept.name}</h3>
            <code className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
              {dept.key}
            </code>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{dept.mission}</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-px border-b border-border bg-border">
        <div className="bg-card p-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Tier</div>
          <div className="mt-1 inline-flex items-center">
            <span className={`px-1.5 py-0.5 text-[11px] font-mono ${tierTone(dept.defaultPreferredTier)}`}>
              {dept.defaultPreferredTier}
            </span>
          </div>
        </div>
        <div className="bg-card p-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Budget / mo</div>
          <div className="mt-1 text-sm tabular-nums">{formatCents(dept.defaultBudgetMonthlyCents)}</div>
        </div>
        <div className="bg-card p-3">
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Headcount</div>
          <div className="mt-1 text-sm tabular-nums">{agents.length}</div>
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        {dept.allowedTools.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Allowed tools
            </div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {dept.allowedTools.map((tool) => (
                <code
                  key={tool}
                  className="border border-border px-1.5 py-0.5 text-[11px] font-mono"
                >
                  {tool}
                </code>
              ))}
            </div>
          </div>
        )}

        {dept.qualityStandards.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Quality standards
            </div>
            <ul className="mt-1.5 space-y-1 text-xs leading-5 text-muted-foreground">
              {dept.qualityStandards.map((standard, i) => (
                <li key={i} className="flex gap-2">
                  <span aria-hidden className="text-muted-foreground/40">•</span>
                  <span>{standard}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {agents.length > 0 && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Roster
            </div>
            <ul className="mt-1.5 space-y-0.5 text-xs">
              {agents.slice(0, 8).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{a.name}</span>
                  <span className="text-muted-foreground text-[10px] font-mono uppercase shrink-0">
                    {(a as Agent & { tier?: string }).tier ?? "—"}
                  </span>
                </li>
              ))}
              {agents.length > 8 && (
                <li className="text-muted-foreground italic">+{agents.length - 8} more</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

export function Departments() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const companyId = selectedCompanyId ?? NO_COMPANY;

  useEffect(() => {
    setBreadcrumbs([{ label: "Departments" }]);
  }, [setBreadcrumbs]);

  const {
    data: deptData,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["departments", companyId],
    queryFn: () => departmentsApi.list(companyId),
    enabled: !!selectedCompanyId,
  });

  const { data: agents } = useQuery({
    queryKey: ["agents", companyId],
    queryFn: () => agentsApi.list(companyId),
    enabled: !!selectedCompanyId,
  });

  const seedMutation = useMutation({
    mutationFn: () => departmentsApi.seed(companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["departments", companyId] });
    },
  });

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a company first.</p>;
  }
  if (isLoading) return <PageSkeleton variant="dashboard" />;
  if (error) {
    return <p className="text-sm text-destructive">{error instanceof Error ? error.message : String(error)}</p>;
  }

  const departments = deptData?.departments ?? [];
  const agentsByDept = new Map<string, Agent[]>();
  for (const agent of agents ?? []) {
    const deptId = (agent as Agent & { departmentId?: string | null }).departmentId ?? null;
    if (!deptId) continue;
    const list = agentsByDept.get(deptId) ?? [];
    list.push(agent);
    agentsByDept.set(deptId, list);
  }

  if (departments.length === 0) {
    return (
      <div className="space-y-4">
        <EmptyState
          icon={Network}
          message="No departments yet. Seed the eight v1 defaults to get started."
          action="Seed default departments"
          onAction={() => seedMutation.mutate()}
        />
        {seedMutation.error && (
          <p className="text-sm text-destructive text-center">
            {seedMutation.error instanceof Error
              ? seedMutation.error.message
              : "Failed to seed departments"}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {departments.length} department{departments.length === 1 ? "" : "s"} ·{" "}
          {agents?.length ?? 0} agent{(agents?.length ?? 0) === 1 ? "" : "s"} assigned
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => seedMutation.mutate()}
          disabled={seedMutation.isPending}
        >
          {seedMutation.isPending ? "Seeding…" : "Seed missing defaults"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {departments
          .slice()
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((dept) => (
            <DepartmentCard
              key={dept.id}
              dept={dept}
              agents={agentsByDept.get(dept.id) ?? []}
            />
          ))}
      </div>
    </div>
  );
}
