import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Users } from "lucide-react";
import {
  meetingsApi,
  MEETING_MODES,
  MEETING_STATES,
  MEETING_NEXT_STATES,
  type Meeting,
  type MeetingMode,
  type MeetingState,
  type Outcome,
  type OutcomeKind,
} from "../api/meetings";
import { agentsApi } from "../api/agents";
import { departmentsApi } from "../api/departments";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import type { Agent } from "@nessie/shared";

const NO_COMPANY = "__none__";
const OUTCOME_KINDS: OutcomeKind[] = ["DECIDE", "ACTION", "MEMORY", "ISSUE"];

function stateTone(s: MeetingState) {
  switch (s) {
    case "draft": return "bg-muted text-muted-foreground";
    case "preparing": return "bg-sky-500/15 text-sky-700 dark:text-sky-400";
    case "active": return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "waiting_for_operator": return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    case "synthesizing": return "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400";
    case "completed": return "bg-emerald-600/20 text-emerald-700 dark:text-emerald-300";
    case "abandoned": return "bg-muted text-muted-foreground";
    case "failed": return "bg-destructive/15 text-destructive";
    default: return "bg-muted";
  }
}

function StateBadge({ state }: { state: MeetingState }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${stateTone(state)}`}>
      {state.replaceAll("_", " ")}
    </span>
  );
}

function OutcomeKindBadge({ kind }: { kind: OutcomeKind }) {
  const tone =
    kind === "DECIDE" ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
    : kind === "ACTION" ? "bg-sky-500/15 text-sky-700 dark:text-sky-400"
    : kind === "MEMORY" ? "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400"
    : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
  return <span className={`px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${tone}`}>{kind}</span>;
}

function CreateMeetingForm({
  companyId,
  agents,
  departments,
  onCreated,
  onCancel,
}: {
  companyId: string;
  agents: Agent[];
  departments: { id: string; name: string }[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<MeetingMode>("operator_led");
  const [agenda, setAgenda] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [facilitator, setFacilitator] = useState("");
  const [budget, setBudget] = useState("");
  const [turnLimit, setTurnLimit] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      meetingsApi.create(companyId, {
        title,
        mode,
        agendaMarkdown: agenda || null,
        departmentId: departmentId || null,
        facilitatorAgentId: facilitator || null,
        budgetCents: budget ? Number(budget) : undefined,
        turnLimit: turnLimit ? Number(turnLimit) : undefined,
      }),
    onSuccess: () => onCreated(),
  });

  return (
    <form
      className="space-y-3 border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) mutation.mutate();
      }}
    >
      <h3 className="text-sm font-semibold">New meeting</h3>
      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Title</span>
        <input
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full border border-border bg-background px-2 py-1.5 text-sm"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Agenda</span>
        <textarea
          rows={3}
          value={agenda}
          onChange={(e) => setAgenda(e.target.value)}
          className="w-full border border-border bg-background px-2 py-1.5 text-sm"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block space-y-1">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Mode</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as MeetingMode)}
            className="w-full border border-border bg-background px-2 py-1.5 text-sm"
          >
            {MEETING_MODES.map((m) => (
              <option key={m} value={m}>{m.replaceAll("_", " ")}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Department</span>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="w-full border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Facilitator</span>
          <select
            value={facilitator}
            onChange={(e) => setFacilitator(e.target.value)}
            className="w-full border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Budget¢</span>
            <input
              type="number"
              value={budget}
              onChange={(e) => setBudget(e.target.value)}
              className="w-full border border-border bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Turns</span>
            <input
              type="number"
              value={turnLimit}
              onChange={(e) => setTurnLimit(e.target.value)}
              className="w-full border border-border bg-background px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
        </div>
      </div>
      {mutation.error && (
        <p className="text-xs text-destructive">
          {mutation.error instanceof Error ? mutation.error.message : "Failed"}
        </p>
      )}
      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" size="sm" disabled={mutation.isPending || !title.trim()}>
          {mutation.isPending ? "Creating…" : "Create meeting"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

function MeetingDetail({
  meeting,
  companyId,
  agents,
  onMutated,
}: {
  meeting: Meeting;
  companyId: string;
  agents: Agent[];
  onMutated: () => void;
}) {
  const detail = useQuery({
    queryKey: ["meetings", companyId, meeting.id],
    queryFn: () => meetingsApi.get(companyId, meeting.id),
  });

  const transitionMutation = useMutation({
    mutationFn: (to: MeetingState) => meetingsApi.transition(companyId, meeting.id, to),
    onSuccess: () => {
      onMutated();
      detail.refetch();
    },
  });
  const addMessageMutation = useMutation({
    mutationFn: (body: string) =>
      meetingsApi.addMessage(meeting.id, { role: "operator", bodyMarkdown: body }),
    onSuccess: () => detail.refetch(),
  });
  const addParticipantMutation = useMutation({
    mutationFn: (agentId: string) => meetingsApi.addParticipant(meeting.id, agentId, "panel"),
    onSuccess: () => detail.refetch(),
  });
  const addOutcomeMutation = useMutation({
    mutationFn: ({ kind, text }: { kind: OutcomeKind; text: string }) =>
      meetingsApi.addOutcome(meeting.id, kind, { text }),
    onSuccess: () => detail.refetch(),
  });
  const approveOutcomeMutation = useMutation({
    mutationFn: (outcomeId: string) => meetingsApi.approveOutcome(outcomeId),
    onSuccess: () => detail.refetch(),
  });
  const applyOutcomesMutation = useMutation({
    mutationFn: () => meetingsApi.applyOutcomes(meeting.id),
    onSuccess: () => detail.refetch(),
  });

  const next = MEETING_NEXT_STATES[meeting.state] ?? [];
  const agentMap = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents) m.set(a.id, a);
    return m;
  }, [agents]);

  const [msgDraft, setMsgDraft] = useState("");
  const [outcomeText, setOutcomeText] = useState("");
  const [outcomeKind, setOutcomeKind] = useState<OutcomeKind>("DECIDE");
  const [participantAgent, setParticipantAgent] = useState("");

  if (detail.isLoading) {
    return <p className="text-xs text-muted-foreground italic px-3 py-2">Loading detail…</p>;
  }
  if (!detail.data) return null;

  const { participants, messages, outcomes } = detail.data;

  return (
    <div className="space-y-4 border-t border-border px-3 py-3">
      {meeting.agendaMarkdown && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Agenda</div>
          <p className="mt-1 text-xs leading-5">{meeting.agendaMarkdown}</p>
        </div>
      )}

      {next.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Transition →</span>
          {next.map((to) => (
            <Button
              key={to}
              size="sm"
              variant={to === "abandoned" || to === "failed" ? "ghost" : "outline"}
              onClick={() => transitionMutation.mutate(to)}
              disabled={transitionMutation.isPending}
            >
              {to.replaceAll("_", " ")}
            </Button>
          ))}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Participants ({participants.length})
            </h4>
          </div>
          <ul className="mt-2 space-y-1 text-xs">
            {participants.map((p) => (
              <li key={p.id} className="flex items-center justify-between">
                <span>{agentMap.get(p.agentId)?.name ?? p.agentId.slice(0, 8)}</span>
                <span className="text-[10px] font-mono uppercase text-muted-foreground">{p.role}</span>
              </li>
            ))}
          </ul>
          <form
            className="mt-2 flex gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (participantAgent) {
                addParticipantMutation.mutate(participantAgent);
                setParticipantAgent("");
              }
            }}
          >
            <select
              value={participantAgent}
              onChange={(e) => setParticipantAgent(e.target.value)}
              className="flex-1 border border-border bg-background px-2 py-1 text-xs"
            >
              <option value="">+ add agent…</option>
              {agents
                .filter((a) => !participants.find((p) => p.agentId === a.id))
                .map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
            </select>
            <Button type="submit" size="sm" disabled={!participantAgent}>Add</Button>
          </form>
        </div>

        <div>
          <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Outcomes ({outcomes.length})
          </h4>
          <ul className="mt-2 space-y-2">
            {outcomes.map((o: Outcome) => (
              <li key={o.id} className="border border-border p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <OutcomeKindBadge kind={o.kind} />
                  <div className="flex items-center gap-1">
                    {!o.approvedByOperator ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => approveOutcomeMutation.mutate(o.id)}
                        disabled={approveOutcomeMutation.isPending}
                      >
                        Approve
                      </Button>
                    ) : (
                      <span className="text-[10px] uppercase text-emerald-600 dark:text-emerald-400">approved</span>
                    )}
                  </div>
                </div>
                <pre className="mt-1.5 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                  {JSON.stringify(o.payload, null, 2)}
                </pre>
              </li>
            ))}
          </ul>

          <form
            className="mt-2 space-y-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (outcomeText.trim()) {
                addOutcomeMutation.mutate({ kind: outcomeKind, text: outcomeText });
                setOutcomeText("");
              }
            }}
          >
            <div className="flex gap-1">
              <select
                value={outcomeKind}
                onChange={(e) => setOutcomeKind(e.target.value as OutcomeKind)}
                className="border border-border bg-background px-2 py-1 text-xs"
              >
                {OUTCOME_KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
              <input
                placeholder="outcome text"
                value={outcomeText}
                onChange={(e) => setOutcomeText(e.target.value)}
                className="flex-1 border border-border bg-background px-2 py-1 text-xs"
              />
              <Button type="submit" size="sm" disabled={!outcomeText.trim()}>Add</Button>
            </div>
          </form>

          {outcomes.some((o) => o.approvedByOperator && !o.appliedAt) && (
            <Button
              variant="outline"
              size="sm"
              className="mt-2 w-full"
              onClick={() => applyOutcomesMutation.mutate()}
              disabled={applyOutcomesMutation.isPending}
            >
              {applyOutcomesMutation.isPending ? "Applying…" : "Apply ready outcomes"}
            </Button>
          )}
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          Transcript ({messages.length} turn{messages.length === 1 ? "" : "s"})
        </h4>
        <ul className="mt-2 max-h-96 space-y-2 overflow-y-auto pr-1">
          {messages.map((m) => {
            const author =
              m.role === "operator" ? "Operator"
              : m.agentId ? agentMap.get(m.agentId)?.name ?? "Agent"
              : m.role;
            return (
              <li key={m.id} className="border-l-2 border-border pl-2 text-xs">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="font-medium text-foreground">{author}</span>
                  <span className="font-mono uppercase">{m.role}</span>
                  <span className="tabular-nums">turn {m.turnIndex}</span>
                  {m.costCents > 0 && <span className="tabular-nums">{m.costCents}¢</span>}
                </div>
                <p className="mt-0.5 leading-5 whitespace-pre-wrap">{m.bodyMarkdown}</p>
              </li>
            );
          })}
          {messages.length === 0 && (
            <li className="text-xs text-muted-foreground italic">No turns yet.</li>
          )}
        </ul>

        <form
          className="mt-2 flex gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (msgDraft.trim()) {
              addMessageMutation.mutate(msgDraft);
              setMsgDraft("");
            }
          }}
        >
          <input
            placeholder="Operator message"
            value={msgDraft}
            onChange={(e) => setMsgDraft(e.target.value)}
            className="flex-1 border border-border bg-background px-2 py-1 text-xs"
          />
          <Button type="submit" size="sm" disabled={!msgDraft.trim()}>Send</Button>
        </form>
      </div>
    </div>
  );
}

function MeetingRow({
  meeting,
  companyId,
  agents,
  expanded,
  onToggle,
  onMutated,
}: {
  meeting: Meeting;
  companyId: string;
  agents: Agent[];
  expanded: boolean;
  onToggle: () => void;
  onMutated: () => void;
}) {
  return (
    <div className="border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/40"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <StateBadge state={meeting.state} />
        <span className="flex-1 truncate text-sm font-medium">{meeting.title}</span>
        <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
          {meeting.mode.replaceAll("_", " ")}
        </span>
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {meeting.turnsUsed}{meeting.turnLimit ? `/${meeting.turnLimit}` : ""} turns
        </span>
        {meeting.spentCents > 0 && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {meeting.spentCents}¢
          </span>
        )}
        <span className="text-[10px] tabular-nums text-muted-foreground">
          {new Date(meeting.createdAt).toLocaleDateString()}
        </span>
      </button>
      {expanded && (
        <MeetingDetail
          meeting={meeting}
          companyId={companyId}
          agents={agents}
          onMutated={onMutated}
        />
      )}
    </div>
  );
}

export function Meetings() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const companyId = selectedCompanyId ?? NO_COMPANY;
  const [filter, setFilter] = useState<MeetingState | "all">("all");
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Meetings" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["meetings", companyId, filter],
    queryFn: () => meetingsApi.list(companyId, filter === "all" ? undefined : filter),
    enabled: !!selectedCompanyId,
  });
  const { data: agents } = useQuery({
    queryKey: ["agents", companyId],
    queryFn: () => agentsApi.list(companyId),
    enabled: !!selectedCompanyId,
  });
  const { data: deptData } = useQuery({
    queryKey: ["departments", companyId],
    queryFn: () => departmentsApi.list(companyId),
    enabled: !!selectedCompanyId,
  });

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a company first.</p>;
  }
  if (isLoading) return <PageSkeleton variant="list" />;
  if (error) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }

  const meetings = data?.meetings ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["meetings", companyId] });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`border px-2 py-1 text-[11px] uppercase tracking-wider ${
              filter === "all"
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            All ({meetings.length})
          </button>
          {MEETING_STATES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`border px-2 py-1 text-[11px] uppercase tracking-wider ${
                filter === s
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {s.replaceAll("_", " ")}
            </button>
          ))}
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <Users className="mr-1.5 h-3.5 w-3.5" />
            New meeting
          </Button>
        )}
      </div>

      {creating && (
        <CreateMeetingForm
          companyId={companyId}
          agents={agents ?? []}
          departments={deptData?.departments ?? []}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {meetings.length === 0 ? (
        <EmptyState
          icon={Users}
          message="No meetings yet. Schedule one to start a typed multi-agent conversation."
        />
      ) : (
        <div className="space-y-2">
          {meetings.map((m) => (
            <MeetingRow
              key={m.id}
              meeting={m}
              companyId={companyId}
              agents={agents ?? []}
              expanded={expandedId === m.id}
              onToggle={() => setExpandedId(expandedId === m.id ? null : m.id)}
              onMutated={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
