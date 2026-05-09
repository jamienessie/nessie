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
import { StackCard, StackButton, StackKpi, StackChip } from "@/components/stack";

const NO_COMPANY = "__none__";

function formatCents(cents: number): string {
  if (cents === 0) return "$0";
  if (cents < 100) return `${cents}¢`;
  const dollars = cents / 100;
  return dollars >= 100 ? `$${Math.round(dollars).toLocaleString()}` : `$${dollars.toFixed(2)}`;
}

function tierColor(tier: string) {
  if (tier === "T1") return "#FFE6B5";
  if (tier === "T2") return "#DDD2FF";
  return "#C2EED8";
}

function DepartmentCard({ dept, agents }: { dept: Department; agents: Agent[] }) {
  const swatch = dept.color || "oklch(0.7 0 0)";
  return (
    <StackCard accent={swatch}>
      <div className="flex items-start gap-3 border-b-[1.5px] border-[#0d0c10] px-4 py-3">
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

      <div className="grid grid-cols-3 gap-px border-b-[1.5px] border-[#0d0c10] bg-[#0d0c10]">
        <div className="bg-[#fffaf0] p-3">
          <StackKpi label="Tier" big={dept.defaultPreferredTier} color={tierColor(dept.defaultPreferredTier)} />
        </div>
        <div className="bg-[#fffaf0] p-3">
          <StackKpi label="Budget / mo" big={formatCents(dept.defaultBudgetMonthlyCents)} color="#FF3FA4" />
        </div>
        <div className="bg-[#fffaf0] p-3">
          <StackKpi label="Headcount" big={String(agents.length)} color="#FF3FA4" />
        </div>
      </div>

      <div className="space-y-3 px-4 py-3">
        {dept.allowedTools.length > 0 && (
          <div>
            <div className="stack-mono-label">Allowed tools</div>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {dept.allowedTools.map((tool) => (
                <StackChip key={tool} color="#FFF8E8">{tool}</StackChip>
              ))}
            </div>
          </div>
        )}

        {dept.qualityStandards.length > 0 && (
          <div>
            <div className="stack-mono-label">Quality standards</div>
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
            <div className="stack-mono-label">Roster</div>
            <ul className="mt-1.5 space-y-0.5 text-xs">
              {agents.slice(0, 8).map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2">
                  <span className="truncate">{a.name}</span>
                  <StackChip color={tierColor((a as Agent & { tier?: string }).tier ?? "")}>{(a as Agent & { tier?: string }).tier ?? "—"}</StackChip>
                </li>
              ))}
              {agents.length > 8 && (
                <li className="text-muted-foreground italic">+{agents.length - 8} more</li>
              )}
            </ul>
          </div>
        )}
      </div>
    </StackCard>
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
        <StackButton
          color="#FF3FA4"
          onClick={() => seedMutation.mutate()}
          disabled={seedMutation.isPending}
        >
          {seedMutation.isPending ? "Seeding…" : "Seed missing defaults"}
        </StackButton>
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
