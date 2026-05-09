import { useMemo } from "react";
import { Link } from "@/lib/router";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Bot,
  Calendar,
  CircleDollarSign,
  ClipboardCheck,
  FileWarning,
  History,
  ShieldAlert,
} from "lucide-react";
import { chiefOfStaffApi, type ChiefDashboardCounts } from "@/api/chiefOfStaff";
import { activityApi } from "@/api/activity";
import { meetingsApi, type Meeting } from "@/api/meetings";
import { agentsApi } from "@/api/agents";
import { accessApi } from "@/api/access";
import { issuesApi } from "@/api/issues";
import { projectsApi } from "@/api/projects";
import { buildCompanyUserProfileMap } from "@/lib/company-members";
import { MetricCard } from "@/components/MetricCard";
import { ActivityRow } from "@/components/ActivityRow";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { Skeleton } from "@/components/ui/skeleton";
import { formatCents } from "@/lib/utils";
import { cn } from "@/lib/utils";
import type { Agent, Issue } from "@nessie/shared";

interface ChiefDashboardPaneProps {
  companyId: string;
  /** Inject mock data for the DesignGuide showcase. */
  mock?: {
    counts: ChiefDashboardCounts;
    meetings: Meeting[];
    agents: Agent[];
  };
}

export function ChiefDashboardPane({ companyId, mock }: ChiefDashboardPaneProps) {
  const counts = useQuery({
    queryKey: ["chief-of-staff", "dashboard", companyId],
    queryFn: () => chiefOfStaffApi.dashboard(companyId),
    enabled: !mock,
    refetchInterval: 30_000,
  });

  const activity = useQuery({
    queryKey: ["chief-of-staff", "activity", companyId],
    queryFn: () => activityApi.list(companyId, { limit: 12 }),
    enabled: !mock,
    refetchInterval: 30_000,
  });

  const meetingsQ = useQuery({
    queryKey: ["chief-of-staff", "meetings-today", companyId],
    queryFn: () => meetingsApi.list(companyId),
    enabled: !mock,
    refetchInterval: 30_000,
  });

  const agentsQ = useQuery({
    queryKey: ["agents", companyId, "for-chief"],
    queryFn: () => agentsApi.list(companyId),
    enabled: !mock,
  });

  const issuesQ = useQuery({
    queryKey: ["issues", companyId, "for-chief"],
    queryFn: () => issuesApi.list(companyId),
    enabled: !mock,
  });

  const projectsQ = useQuery({
    queryKey: ["projects", companyId, "for-chief"],
    queryFn: () => projectsApi.list(companyId),
    enabled: !mock,
  });

  const usersQ = useQuery({
    queryKey: ["access", companyId, "for-chief"],
    queryFn: () => accessApi.listUserDirectory(companyId),
    enabled: !mock,
  });

  const dashboardCounts = mock?.counts ?? counts.data;
  const recentActivity = mock ? [] : activity.data ?? [];
  const allMeetings: Meeting[] = mock?.meetings ?? meetingsQ.data?.meetings ?? [];
  const agents = mock?.agents ?? agentsQ.data ?? [];
  const issues = issuesQ.data ?? [];
  const projects = projectsQ.data ?? [];

  const todaysMeetings = useMemo(() => {
    if (mock) return mock.meetings;
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return allMeetings.filter((m) => {
      if (m.state === "active" || m.state === "waiting_for_operator") return true;
      if (!m.scheduledAt) return false;
      const scheduled = new Date(m.scheduledAt);
      return scheduled >= start && scheduled < end;
    });
  }, [allMeetings, mock]);

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents) map.set(a.id, a);
    return map;
  }, [agents]);

  const userProfileMap = useMemo(
    () => buildCompanyUserProfileMap(usersQ.data?.users),
    [usersQ.data?.users],
  );

  const entityNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues) map.set(`issue:${i.id}`, i.identifier ?? i.id.slice(0, 8));
    for (const a of agents) map.set(`agent:${a.id}`, a.name);
    for (const p of projects) map.set(`project:${p.id}`, p.name);
    return map;
  }, [issues, agents, projects]);

  const entityTitleMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const i of issues as Issue[]) map.set(`issue:${i.id}`, i.title);
    return map;
  }, [issues]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="space-y-5 p-5">
        <header className="space-y-1">
          <h1 className="text-xl font-bold">Chief of Staff</h1>
          <div className="h-[2px] w-12 rounded-full" style={{ backgroundColor: "var(--tone-operator-fg)" }} />
          <p className="text-sm text-muted-foreground">
            What's happening across your company, right now.
          </p>
        </header>

        {/* KPIs — 6 metrics, 2×3 mobile, 3×2 wider */}
        <section className="space-y-2">
          <SectionHeading>Snapshot</SectionHeading>
          {dashboardCounts ? (
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
              <MetricCard
                icon={ShieldAlert}
                tone="warning"
                value={dashboardCounts.blockedIssues}
                label="Blocked"
                to="/issues"
              />
              <MetricCard
                icon={ClipboardCheck}
                tone="warning"
                value={dashboardCounts.pendingApprovals}
                label="Pending approvals"
                to="/inbox/requests"
              />
              <MetricCard
                icon={Bot}
                tone="info"
                value={dashboardCounts.liveAgents}
                label="Live agents"
                to="/agents"
              />
              <MetricCard
                icon={CircleDollarSign}
                tone="spend"
                value={formatCents(dashboardCounts.weekSpendCents)}
                label="Spend (7d)"
                to="/costs"
              />
              <MetricCard
                icon={FileWarning}
                tone="info"
                value={dashboardCounts.openContracts}
                label="Open contracts"
                to="/trust-layer"
              />
              <MetricCard
                icon={AlertTriangle}
                tone="warning"
                value={dashboardCounts.lowRepAgents}
                label="Low-rep agents"
                to="/agents"
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-24 rounded-xl" />
              ))}
            </div>
          )}
        </section>

        {/* Today's meetings */}
        <section className="space-y-2">
          <SectionHeading>Today's meetings</SectionHeading>
          {todaysMeetings.length === 0 ? (
            <Card className="py-4">
              <CardContent className="flex items-center gap-3 px-4 py-0 text-sm text-muted-foreground">
                <Calendar className="size-4" />
                <span>No meetings on the calendar.</span>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {todaysMeetings.slice(0, 6).map((meeting) => (
                <Card key={meeting.id} className="py-3 gap-2">
                  <CardContent className="flex items-center gap-3 px-4 py-0">
                    <StatusBadge status={meeting.state} />
                    <span className="flex-1 truncate text-sm font-medium">{meeting.title}</span>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/meetings/${meeting.id}/room`}>Enter →</Link>
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* Recent activity */}
        <section className="space-y-2">
          <SectionHeading>Recent activity</SectionHeading>
          {recentActivity.length === 0 ? (
            <EmptyState icon={History} message="Quiet around here." />
          ) : (
            <Card className="py-0 overflow-hidden">
              <div className="divide-y divide-border">
                {recentActivity.map((event) => (
                  <ActivityRow
                    key={event.id}
                    event={event}
                    agentMap={agentMap}
                    userProfileMap={userProfileMap}
                    entityNameMap={entityNameMap}
                    entityTitleMap={entityTitleMap}
                  />
                ))}
              </div>
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className={cn("text-xs font-semibold uppercase tracking-wide text-muted-foreground")}>
      {children}
    </h3>
  );
}
