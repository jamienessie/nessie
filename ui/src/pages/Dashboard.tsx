import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi } from "../api/dashboard";
import { activityApi } from "../api/activity";
import { accessApi } from "../api/access";
import { issuesApi } from "../api/issues";
import { agentsApi } from "../api/agents";
import { projectsApi } from "../api/projects";
import { buildCompanyUserProfileMap } from "../lib/company-members";
import { useCompany } from "../context/CompanyContext";
import { useDialogActions } from "../context/DialogContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { MetricCard } from "../components/MetricCard";
import { EmptyState } from "../components/EmptyState";
import { StatusIcon } from "../components/StatusIcon";

import { NewsTicker } from "../components/NewsTicker";
import { DreamsWidget } from "../components/DreamsWidget";
import { Identity } from "../components/Identity";
import { timeAgo } from "../lib/timeAgo";
import { useNewsroomLive } from "../lib/useNewsroomLive";
import { cn, formatCents } from "../lib/utils";
import { Bot, CircleDot, DollarSign, ShieldCheck, LayoutDashboard, PauseCircle } from "lucide-react";
import { ActiveAgentsPanel } from "../components/ActiveAgentsPanel";
import { ChartCard, RunActivityChart, PriorityChart, IssueStatusChart, SuccessRateChart } from "../components/ActivityCharts";
import { PageSkeleton } from "../components/PageSkeleton";
import type { Agent, Issue } from "@nessie/shared";
import { PluginSlotOutlet } from "@/plugins/slots";

const DASHBOARD_ACTIVITY_LIMIT = 10;

function getRecentIssues(issues: Issue[]): Issue[] {
  return [...issues]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function Dashboard() {
  const { selectedCompanyId, companies } = useCompany();
  const { openOnboarding } = useDialogActions();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [animatedActivityIds, setAnimatedActivityIds] = useState<Set<string>>(new Set());
  const seenActivityIdsRef = useRef<Set<string>>(new Set());
  const hydratedActivityRef = useRef(false);
  const activityAnimationTimersRef = useRef<number[]>([]);

  const { data: agents } = useQuery({
    queryKey: queryKeys.agents.list(selectedCompanyId!),
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  useEffect(() => {
    setBreadcrumbs([{ label: "Dashboard" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: queryKeys.dashboard(selectedCompanyId!),
    queryFn: () => dashboardApi.summary(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: activity } = useQuery({
    queryKey: [...queryKeys.activity(selectedCompanyId!), { limit: DASHBOARD_ACTIVITY_LIMIT }],
    queryFn: () => activityApi.list(selectedCompanyId!, { limit: DASHBOARD_ACTIVITY_LIMIT }),
    enabled: !!selectedCompanyId,
  });

  // Newsroom: subscribe to the company's live event WebSocket and prepend
  // `activity.logged` events into the React Query cache as they arrive. The
  // poll query above continues to run as a backstop in case the WS drops.
  useNewsroomLive(selectedCompanyId);

  const { data: issues } = useQuery({
    queryKey: queryKeys.issues.list(selectedCompanyId!),
    queryFn: () => issuesApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: projects } = useQuery({
    queryKey: queryKeys.projects.list(selectedCompanyId!),
    queryFn: () => projectsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const { data: companyMembers } = useQuery({
    queryKey: queryKeys.access.companyUserDirectory(selectedCompanyId!),
    queryFn: () => accessApi.listUserDirectory(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const userProfileMap = useMemo(
    () => buildCompanyUserProfileMap(companyMembers?.users),
    [companyMembers?.users],
  );

  const recentIssues = issues ? getRecentIssues(issues) : [];
  const recentActivity = useMemo(() => (activity ?? []).slice(0, 10), [activity]);

  useEffect(() => {
    for (const timer of activityAnimationTimersRef.current) {
      window.clearTimeout(timer);
    }
    activityAnimationTimersRef.current = [];
    seenActivityIdsRef.current = new Set();
    hydratedActivityRef.current = false;
    setAnimatedActivityIds(new Set());
  }, [selectedCompanyId]);

  useEffect(() => {
    if (recentActivity.length === 0) return;

    const seen = seenActivityIdsRef.current;
    const currentIds = recentActivity.map((event) => event.id);

    if (!hydratedActivityRef.current) {
      for (const id of currentIds) seen.add(id);
      hydratedActivityRef.current = true;
      return;
    }

    const newIds = currentIds.filter((id) => !seen.has(id));
    if (newIds.length === 0) {
      for (const id of currentIds) seen.add(id);
      return;
    }

    setAnimatedActivityIds((prev) => {
      const next = new Set(prev);
      for (const id of newIds) next.add(id);
      return next;
    });

    for (const id of newIds) seen.add(id);

    const timer = window.setTimeout(() => {
      setAnimatedActivityIds((prev) => {
        const next = new Set(prev);
        for (const id of newIds) next.delete(id);
        return next;
      });
      activityAnimationTimersRef.current = activityAnimationTimersRef.current.filter((t) => t !== timer);
    }, 980);
    activityAnimationTimersRef.current.push(timer);
  }, [recentActivity]);

  useEffect(() => {
    return () => {
      for (const timer of activityAnimationTimersRef.current) {
        window.clearTimeout(timer);
      }
    };
  }, []);

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) map.set(`issue:${i.id}`, i.identifier ?? i.id.slice(0, 8));
    for (const a of agents ?? []) map.set(`agent:${a.id}`, a.name);
    for (const p of projects ?? []) map.set(`project:${p.id}`, p.name);
    return map;
  }, [issues, agents, projects]);

  const entityTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues ?? []) map.set(`issue:${i.id}`, i.title);
    return map;
  }, [issues]);

  const agentName = (id: string | null) => {
    if (!id || !agents) return null;
    return agents.find((a) => a.id === id)?.name ?? null;
  };

  if (!selectedCompanyId) {
    if (companies.length === 0) {
      return (
        <EmptyState
          icon={LayoutDashboard}
          message="Welcome to Paperclip. Set up your first company and agent to get started."
          action="Get Started"
          onAction={openOnboarding}
        />
      );
    }
    return (
      <EmptyState icon={LayoutDashboard} message="Create or select a company to view the dashboard." />
    );
  }

  if (isLoading) {
    return <PageSkeleton variant="dashboard" />;
  }

  const hasNoAgents = agents !== undefined && agents.length === 0;

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error.message}</p>}

      {hasNoAgents && (
        <div className="flex items-center justify-between gap-3 stack-card px-4 py-3" style={{ background: "#FFF1B8" }}>
          <div className="flex items-center gap-2.5">
            <Bot className="h-4 w-4 text-[#FF8A1A] shrink-0" />
            <p className="text-sm font-semibold text-[#0d0c10]">
              You have no agents.
            </p>
          </div>
          <button
            onClick={() => openOnboarding({ initialStep: 2, companyId: selectedCompanyId! })}
            className="text-sm font-bold text-[#0d0c10] underline underline-offset-2 shrink-0"
          >
            Create one here
          </button>
        </div>
      )}

      <ActiveAgentsPanel companyId={selectedCompanyId!} />

      {data && (
        <>
          {data.budgets.activeIncidents > 0 ? (
            <div className="flex items-start justify-between gap-3 stack-card px-4 py-3" style={{ background: "#FFD1C4" }}>
              <div className="flex items-start gap-2.5">
                <PauseCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#FF4D2E]" />
                <div>
                  <p className="text-sm font-extrabold text-[#0d0c10]">
                    {data.budgets.activeIncidents} active budget incident{data.budgets.activeIncidents === 1 ? "" : "s"}
                  </p>
                  <p className="text-xs font-mono font-bold text-[#3a3340]">
                    {data.budgets.pausedAgents} agents paused · {data.budgets.pausedProjects} projects paused · {data.budgets.pendingApprovals} pending budget approvals
                  </p>
                </div>
              </div>
              <Link to="/costs" className="text-sm font-bold underline underline-offset-2 text-[#0d0c10]">
                Open budgets
              </Link>
            </div>
          ) : null}

          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
            <MetricCard
              value={data.agents.active + data.agents.running + data.agents.paused + data.agents.error}
              label="Agents Enabled"
              to="/agents"
              color="#C2EED8"
              description={
                <span>
                  {data.agents.running} running{" · "}
                  {data.agents.paused} paused{" · "}
                  {data.agents.error} errors
                </span>
              }
            />
            <MetricCard
              value={data.tasks.inProgress}
              label="Tasks In Progress"
              to="/issues"
              color="#C8E5FF"
              description={
                <span>
                  {data.tasks.open} open{" · "}
                  {data.tasks.blocked} blocked
                </span>
              }
            />
            <MetricCard
              value={formatCents(data.costs.monthSpendCents)}
              label="Month Spend"
              to="/costs"
              color="#FFE0BB"
              description={
                <span>
                  {data.costs.monthBudgetCents > 0
                    ? `${data.costs.monthUtilizationPercent}% of ${formatCents(data.costs.monthBudgetCents)} budget`
                    : "Unlimited budget"}
                </span>
              }
            />
            <MetricCard
              value={data.pendingApprovals + data.budgets.pendingApprovals}
              label="Pending Approvals"
              to="/approvals"
              color="#FFD2EA"
              description={
                <span>
                  {data.budgets.pendingApprovals > 0
                    ? `${data.budgets.pendingApprovals} budget overrides awaiting board review`
                    : "Awaiting board review"}
                </span>
              }
            />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <ChartCard title="Run Activity" subtitle="Last 14 days" color="#27D17F">
              <RunActivityChart activity={data.runActivity} />
            </ChartCard>
            <ChartCard title="Issues by Priority" subtitle="Last 14 days" color="#FF4D2E">
              <PriorityChart issues={issues ?? []} />
            </ChartCard>
            <ChartCard title="Issues by Status" subtitle="Last 14 days" color="#1FA7FF">
              <IssueStatusChart issues={issues ?? []} />
            </ChartCard>
            <ChartCard title="Success Rate" subtitle="Last 14 days" color="#FFC83A">
              <SuccessRateChart activity={data.runActivity} />
            </ChartCard>
          </div>

          <PluginSlotOutlet
            slotTypes={["dashboardWidget"]}
            context={{ companyId: selectedCompanyId }}
            className="grid gap-3 md:grid-cols-2"
            itemClassName="stack-card p-4"
          />

          <DreamsWidget companyId={selectedCompanyId!} />

          <div className="grid md:grid-cols-2 gap-3">
            {/* Live Newsroom */}
            {recentActivity.length > 0 && (
              <div className="min-w-0">
                <div className="stack-card flex flex-col min-h-0 overflow-hidden">
                  <div className="stack-panel-header" style={{ ["--stack-accent" as string]: "#A4D81F" }}>
                    <span
                      className="w-3 h-3 rounded-full bg-[#FF4D2E] animate-pulse"
                      aria-label="Live"
                    />
                    LIVE NEWSROOM
                    <span className="flex-1" />
                    <span className="font-mono text-[10px] font-bold">{recentActivity.length} headlines</span>
                  </div>
                  <div className="flex-1 overflow-hidden divide-y-[1.5px] divide-[#0d0c10]">
                    {recentActivity.map((event) => (
                      <NewsTicker
                        key={event.id}
                        event={event}
                        agentMap={agentMap}
                        userProfileMap={userProfileMap}
                        entityNameMap={entityNameMap}
                        entityTitleMap={entityTitleMap}
                        className={animatedActivityIds.has(event.id) ? "activity-row-enter" : undefined}
                      />
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Recent Tasks */}
            <div className="min-w-0">
              <div className="stack-card flex flex-col min-h-0 overflow-hidden">
                <div className="stack-panel-header" style={{ ["--stack-accent" as string]: "#FFC83A" }}>
                  <span className="w-3 h-3 rounded-full bg-[#0d0c10]" />
                  RECENT TASKS
                  <span className="flex-1" />
                  <span className="font-mono text-[10px] font-bold">{recentIssues.length} open</span>
                </div>
                {recentIssues.length === 0 ? (
                  <div className="p-4">
                    <p className="text-sm font-semibold text-[#5a525e]">No tasks yet.</p>
                  </div>
                ) : (
                  <div className="flex-1 overflow-hidden divide-y-[1.5px] divide-[#0d0c10]">
                    {recentIssues.slice(0, 10).map((issue) => (
                      <Link
                        key={issue.id}
                        to={`/issues/${issue.identifier ?? issue.id}`}
                        className="px-4 py-3 text-sm cursor-pointer hover:bg-[#FFF1B8]/40 transition-colors no-underline text-inherit block"
                      >
                        <div className="flex items-start gap-2 sm:items-center sm:gap-3">
                          <span className="shrink-0 sm:hidden">
                            <StatusIcon status={issue.status} blockerAttention={issue.blockerAttention} />
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col gap-1 sm:contents">
                            <span className="line-clamp-2 text-sm font-semibold sm:order-2 sm:flex-1 sm:min-w-0 sm:line-clamp-none sm:truncate text-[#0d0c10]">
                              {issue.title}
                            </span>
                            <span className="flex items-center gap-2 sm:order-1 sm:shrink-0">
                              <span className="hidden sm:inline-flex"><StatusIcon status={issue.status} blockerAttention={issue.blockerAttention} /></span>
                              <span className="text-xs font-mono font-bold text-[#5a525e]">
                                {issue.identifier ?? issue.id.slice(0, 8)}
                              </span>
                              {issue.assigneeAgentId && (() => {
                                const name = agentName(issue.assigneeAgentId);
                                return name
                                  ? <span className="hidden sm:inline-flex"><Identity name={name} size="sm" /></span>
                                  : null;
                              })()}
                              <span className="text-xs text-[#5a525e] sm:hidden">·</span>
                              <span className="text-xs text-[#5a525e] shrink-0 sm:order-last font-mono font-bold">
                                {timeAgo(issue.updatedAt)}
                              </span>
                            </span>
                          </span>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

        </>
      )}
    </div>
  );
}
