import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "@/lib/router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronLeft,
  Pause,
  Play,
  Plus,
  Send,
  Square,
  Sparkles,
  Users,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import {
  meetingsApi,
  type Message,
  type MeetingState,
  type Participant,
} from "../api/meetings";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { Identity } from "../components/Identity";
import { PageSkeleton } from "../components/PageSkeleton";
import { EmptyState } from "../components/EmptyState";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";
import { getAgentAccent } from "@/lib/agent-color";
import { timeAgo } from "../lib/timeAgo";
import type { Agent } from "@nessie/shared";

const MEETING_LIVE_EVENT_TYPES = new Set([
  "meeting.message.added",
  "meeting.transitioned",
  "meeting.participant.added",
  "meeting.outcome.added",
  "meeting.outcome.approved",
  "meeting.turn.starting",
  "meeting.turn.failed",
]);

function stateTone(state: MeetingState): string {
  switch (state) {
    case "active":
      return "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 ring-1 ring-emerald-500/30";
    case "preparing":
      return "bg-sky-500/20 text-sky-700 dark:text-sky-300 ring-1 ring-sky-500/30";
    case "waiting_for_operator":
      return "bg-amber-500/20 text-amber-700 dark:text-amber-300 ring-1 ring-amber-500/30 animate-pulse";
    case "synthesizing":
      return "bg-violet-500/20 text-violet-700 dark:text-violet-300 ring-1 ring-violet-500/30 animate-pulse";
    case "completed":
      return "bg-emerald-600/20 text-emerald-700 dark:text-emerald-300";
    case "abandoned":
      return "bg-muted text-muted-foreground";
    case "failed":
      return "bg-destructive/20 text-destructive";
    default:
      return "bg-muted text-muted-foreground";
  }
}

function StateBadge({ state }: { state: MeetingState }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-1 text-[10px] font-mono uppercase tracking-wider rounded-md",
        stateTone(state),
      )}
    >
      {state.replaceAll("_", " ")}
    </span>
  );
}

function AttendeeChip({ agent, role }: { agent: Agent | undefined; role: string }) {
  const accent = getAgentAccent(agent?.id ?? role);
  const isObserver = role === "observer";
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-background/80 px-2 py-1",
        accent.border,
      )}
      title={agent ? `${agent.name}${agent.title ? ` · ${agent.title}` : ""} (${role})` : role}
    >
      <span className={cn("h-2 w-2 rounded-full", accent.bg)} aria-hidden />
      <span className="text-xs font-medium">{agent?.name ?? "(missing agent)"}</span>
      {!isObserver && agent?.title && (
        <span className="text-[10px] text-muted-foreground">· {agent.title}</span>
      )}
      <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-mono">
        {role}
      </span>
    </div>
  );
}

function MessageBubble({
  message,
  agent,
  isFirstInGroup,
}: {
  message: Message;
  agent: Agent | undefined;
  isFirstInGroup: boolean;
}) {
  if (message.role === "system") {
    return (
      <div className="my-2 flex justify-center">
        <p className="text-[11px] italic text-muted-foreground/70">
          {message.bodyMarkdown.replace(/^_+|_+$/g, "")}
        </p>
      </div>
    );
  }

  const isOperator = message.role === "operator";
  const accent = getAgentAccent(agent?.id ?? message.agentId ?? "operator");
  const speakerName = isOperator
    ? "Operator"
    : agent?.name ?? "Unknown";
  const subtitle = isOperator ? null : agent?.title ?? null;

  return (
    <div className={cn("flex gap-3", isFirstInGroup ? "mt-4" : "mt-1")}>
      <div className="w-8 shrink-0">
        {isFirstInGroup && (
          <div
            className={cn(
              "flex size-8 items-center justify-center rounded-full text-xs font-semibold",
              isOperator
                ? "bg-foreground text-background"
                : cn(accent.bg, accent.text),
            )}
            aria-hidden
          >
            {isOperator ? "OP" : agent ? deriveInitials(agent.name) : "??"}
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        {isFirstInGroup && (
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold">{speakerName}</span>
            {subtitle && (
              <span className="text-xs text-muted-foreground">· {subtitle}</span>
            )}
            <span className="ml-auto text-[10px] text-muted-foreground font-mono">
              turn {message.turnIndex} · {timeAgo(message.createdAt)}
            </span>
          </div>
        )}
        <div
          className={cn(
            "mt-1 rounded-lg border px-3 py-2 text-sm whitespace-pre-wrap break-words",
            isOperator ? "bg-muted/40 border-border" : cn(accent.soft, accent.border),
          )}
        >
          {message.bodyMarkdown}
        </div>
        {message.costCents > 0 && (
          <div className="mt-0.5 text-[10px] text-muted-foreground/60 font-mono">
            ${(message.costCents / 100).toFixed(4)}
          </div>
        )}
      </div>
    </div>
  );
}

function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function useMeetingLiveSocket(
  companyId: string | null,
  meetingId: string,
  onEvent: () => void,
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!companyId) return;
    const protocol = window.location.protocol === "https:" ? "wss" : "ws";
    const url = `${protocol}://${window.location.host}/api/companies/${encodeURIComponent(companyId)}/events/ws`;
    let socket: WebSocket | null = null;
    let cancelled = false;
    let reconnectTimer: number | null = null;

    const connect = () => {
      if (cancelled) return;
      try {
        socket = new WebSocket(url);
      } catch {
        scheduleReconnect();
        return;
      }
      socket.onopen = () => setConnected(true);
      socket.onclose = () => {
        setConnected(false);
        if (!cancelled) scheduleReconnect();
      };
      socket.onerror = () => setConnected(false);
      socket.onmessage = (ev) => {
        try {
          const payload = JSON.parse(typeof ev.data === "string" ? ev.data : "");
          if (!payload || typeof payload !== "object") return;
          const type = String(payload.type ?? "");
          if (!MEETING_LIVE_EVENT_TYPES.has(type)) return;
          const eventMeetingId = (payload.payload as Record<string, unknown> | undefined)?.meetingId;
          if (eventMeetingId !== meetingId) return;
          onEventRef.current();
        } catch {
          /* ignore malformed frames */
        }
      };
    };

    const scheduleReconnect = () => {
      if (cancelled) return;
      reconnectTimer = window.setTimeout(connect, 2000);
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close(1000, "unmount");
      setConnected(false);
    };
  }, [companyId, meetingId]);

  return { connected };
}

export function MeetingRoom() {
  const { meetingId = "" } = useParams<{ meetingId: string }>();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [composer, setComposer] = useState("");
  const messageListRef = useRef<HTMLDivElement | null>(null);

  const detail = useQuery({
    queryKey: ["meeting", selectedCompanyId, meetingId],
    queryFn: () => meetingsApi.get(selectedCompanyId!, meetingId),
    enabled: !!selectedCompanyId && !!meetingId,
    refetchInterval: 5_000,
  });

  const { data: agents } = useQuery({
    queryKey: ["agents", selectedCompanyId, "all"],
    queryFn: () => agentsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
  });

  const agentMap = useMemo(() => {
    const map = new Map<string, Agent>();
    for (const a of agents ?? []) map.set(a.id, a);
    return map;
  }, [agents]);

  const { connected } = useMeetingLiveSocket(selectedCompanyId, meetingId, () => {
    void detail.refetch();
  });

  useEffect(() => {
    if (detail.data?.meeting) {
      setBreadcrumbs([
        { label: "Meetings", href: "/meetings" },
        { label: detail.data.meeting.title },
      ]);
    } else {
      setBreadcrumbs([{ label: "Meetings", href: "/meetings" }, { label: "Room" }]);
    }
  }, [detail.data?.meeting, setBreadcrumbs]);

  // Auto-scroll to bottom when new messages arrive.
  const messages = detail.data?.messages ?? [];
  const messageCount = messages.length;
  useEffect(() => {
    const node = messageListRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [messageCount]);

  const transition = useMutation({
    mutationFn: (to: MeetingState) => meetingsApi.transition(selectedCompanyId!, meetingId, to),
    onSuccess: () => detail.refetch(),
  });

  // Convenience: hop draft → preparing → active in one click.
  const startMeeting = useMutation({
    mutationFn: async () => {
      const current = detail.data?.meeting;
      if (!current) return null;
      if (current.state === "draft") {
        await meetingsApi.transition(selectedCompanyId!, meetingId, "preparing");
      }
      const refreshed = await meetingsApi.get(selectedCompanyId!, meetingId);
      if (refreshed.meeting.state === "preparing" || refreshed.meeting.state === "waiting_for_operator") {
        return meetingsApi.transition(selectedCompanyId!, meetingId, "active");
      }
      return null;
    },
    onSuccess: () => detail.refetch(),
  });

  const sendOperatorMessage = useMutation({
    mutationFn: (body: string) =>
      meetingsApi.addMessage(meetingId, { role: "operator", bodyMarkdown: body }),
    onSuccess: () => {
      setComposer("");
      detail.refetch();
    },
  });

  const addAttendee = useMutation({
    mutationFn: ({ agentId, role }: { agentId: string; role: string }) =>
      meetingsApi.addParticipant(meetingId, agentId, role),
    onSuccess: () => detail.refetch(),
  });

  const [attendeePickerOpen, setAttendeePickerOpen] = useState(false);
  const [pendingAgentId, setPendingAgentId] = useState("");
  const [pendingRole, setPendingRole] = useState("panel");

  if (!selectedCompanyId) {
    return <EmptyState icon={Users} message="Select a company to view this meeting." />;
  }
  if (detail.isLoading) return <PageSkeleton variant="dashboard" />;
  if (detail.error || !detail.data) {
    return <EmptyState icon={Users} message="Meeting not found." />;
  }

  const { meeting, participants, outcomes } = detail.data;
  const participantIds = new Set(participants.map((p) => p.agentId));
  const availableAgents = (agents ?? []).filter((a) => !participantIds.has(a.id) && a.status !== "terminated");
  const canStart =
    meeting.state === "draft"
    || meeting.state === "preparing"
    || meeting.state === "waiting_for_operator";
  const canPause = meeting.state === "active";
  const canSynthesize = meeting.state === "active" || meeting.state === "waiting_for_operator";
  const isLive = meeting.state === "active";

  // Group consecutive messages from the same speaker so we don't repeat avatars.
  const grouped = (() => {
    const result: Array<{ message: Message; isFirstInGroup: boolean }> = [];
    let prevKey = "";
    for (const m of messages) {
      const key = `${m.role}:${m.agentId ?? "_"}`;
      result.push({ message: m, isFirstInGroup: key !== prevKey });
      prevKey = key;
    }
    return result;
  })();

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3">
        <Link
          to="/meetings"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Meetings
        </Link>
        <div className="h-4 w-px bg-border" />
        <h1 className="text-base font-semibold flex-1 min-w-0 truncate">{meeting.title}</h1>
        <StateBadge state={meeting.state} />
        <span
          className={cn(
            "inline-flex items-center gap-1 text-[11px] font-mono",
            connected ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
          )}
          title={connected ? "Live updates connected" : "Reconnecting..."}
        >
          {connected ? <Wifi className="size-3" /> : <WifiOff className="size-3" />}
          {connected ? "live" : "reconnecting"}
        </span>
      </div>

      {/* Attendees + agenda */}
      <div className="shrink-0 border-b border-border bg-muted/30 px-4 py-3 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground">
            Attendees
          </span>
          {participants.length === 0 && (
            <span className="text-xs text-muted-foreground">None yet</span>
          )}
          {participants.map((p: Participant) => (
            <AttendeeChip key={p.id} agent={agentMap.get(p.agentId)} role={p.role} />
          ))}
          {!attendeePickerOpen && availableAgents.length > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setPendingAgentId(availableAgents[0]?.id ?? "");
                setPendingRole("panel");
                setAttendeePickerOpen(true);
              }}
              className="h-7"
            >
              <Plus className="size-3" />
              Add attendee
            </Button>
          )}
          {attendeePickerOpen && (
            <form
              className="inline-flex flex-wrap items-center gap-1 rounded-md border border-border bg-background px-2 py-1"
              onSubmit={(e) => {
                e.preventDefault();
                if (!pendingAgentId) return;
                addAttendee.mutate(
                  { agentId: pendingAgentId, role: pendingRole },
                  {
                    onSuccess: () => {
                      setAttendeePickerOpen(false);
                      setPendingAgentId("");
                    },
                  },
                );
              }}
            >
              <select
                value={pendingAgentId}
                onChange={(e) => setPendingAgentId(e.target.value)}
                className="bg-transparent text-xs outline-none"
              >
                <option value="">Pick an agent…</option>
                {availableAgents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.title ? ` · ${a.title}` : ""}
                  </option>
                ))}
              </select>
              <select
                value={pendingRole}
                onChange={(e) => setPendingRole(e.target.value)}
                className="bg-transparent text-[10px] uppercase font-mono outline-none border-l border-border pl-2"
              >
                <option value="host">host</option>
                <option value="panel">panel</option>
                <option value="observer">observer</option>
                <option value="interviewer">interviewer</option>
                <option value="candidate">candidate</option>
              </select>
              <Button type="submit" size="sm" className="h-6 px-2" disabled={!pendingAgentId || addAttendee.isPending}>
                Add
              </Button>
              <button
                type="button"
                onClick={() => setAttendeePickerOpen(false)}
                className="ml-1 inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent/50"
                aria-label="Cancel"
              >
                <X className="size-3" />
              </button>
            </form>
          )}
          {availableAgents.length === 0 && participants.length > 0 && (
            <span className="text-[11px] text-muted-foreground italic">
              All available agents are already attending.
            </span>
          )}
        </div>
        {meeting.agendaMarkdown && (
          <details className="group" open>
            <summary className="cursor-pointer text-[10px] uppercase tracking-widest font-mono text-muted-foreground hover:text-foreground">
              Agenda
            </summary>
            <div className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-background/60 p-3 text-sm">
              {meeting.agendaMarkdown}
            </div>
          </details>
        )}
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground font-mono">
          <span>turn {meeting.turnsUsed ?? 0}/{meeting.turnLimit ?? "∞"}</span>
          {(meeting.budgetCents ?? 0) > 0 && (
            <>
              <span>·</span>
              <span>${((meeting.spentCents ?? 0) / 100).toFixed(2)} / ${((meeting.budgetCents ?? 0) / 100).toFixed(2)}</span>
            </>
          )}
        </div>
      </div>

      {/* Message stream */}
      <div ref={messageListRef} className="flex-1 min-h-0 overflow-y-auto px-4 py-3">
        {grouped.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">
              {isLive
                ? "Waiting for the first turn..."
                : "No messages yet. Start the meeting to kick off the discussion."}
            </p>
          </div>
        ) : (
          grouped.map(({ message, isFirstInGroup }) => (
            <MessageBubble
              key={message.id}
              message={message}
              agent={message.agentId ? agentMap.get(message.agentId) : undefined}
              isFirstInGroup={isFirstInGroup}
            />
          ))
        )}
      </div>

      {/* Outcomes summary (if any) */}
      {outcomes.length > 0 && (
        <div className="shrink-0 border-t border-border bg-muted/20 px-4 py-2">
          <div className="text-[10px] uppercase tracking-widest font-mono text-muted-foreground mb-1">
            Outcomes ({outcomes.length})
          </div>
          <div className="flex flex-wrap gap-2">
            {outcomes.map((o) => (
              <span
                key={o.id}
                className={cn(
                  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider",
                  o.kind === "DECIDE" && "bg-amber-500/20 text-amber-700 dark:text-amber-300",
                  o.kind === "ACTION" && "bg-sky-500/20 text-sky-700 dark:text-sky-300",
                  o.kind === "MEMORY" && "bg-indigo-500/20 text-indigo-700 dark:text-indigo-300",
                  o.kind === "ISSUE" && "bg-emerald-500/20 text-emerald-700 dark:text-emerald-300",
                )}
              >
                {o.kind}
                {o.approvedByOperator ? " ✓" : " (pending)"}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Composer + state actions */}
      <div className="shrink-0 border-t border-border bg-background px-4 py-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          {canStart && (
            <Button
              size="sm"
              onClick={() => startMeeting.mutate()}
              disabled={startMeeting.isPending || participants.length === 0}
              title={participants.length === 0 ? "Add at least one attendee first" : undefined}
            >
              <Play className="size-3" />
              {meeting.state === "draft" || meeting.state === "preparing" ? "Start meeting" : "Resume"}
            </Button>
          )}
          {canPause && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => transition.mutate("waiting_for_operator")}
              disabled={transition.isPending}
            >
              <Pause className="size-3" />
              Pause for checkpoint
            </Button>
          )}
          {canSynthesize && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => transition.mutate("synthesizing")}
              disabled={transition.isPending}
            >
              <Sparkles className="size-3" />
              Synthesize summary
            </Button>
          )}
          {(meeting.state === "active" || meeting.state === "waiting_for_operator") && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => transition.mutate("abandoned")}
              disabled={transition.isPending}
              className="text-destructive hover:text-destructive"
            >
              <Square className="size-3" />
              End meeting
            </Button>
          )}
          {transition.error && (
            <span className="text-xs text-destructive ml-2">
              {transition.error instanceof Error ? transition.error.message : "Transition failed"}
            </span>
          )}
        </div>
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const body = composer.trim();
            if (!body) return;
            sendOperatorMessage.mutate(body);
          }}
        >
          <textarea
            value={composer}
            onChange={(e) => setComposer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const body = composer.trim();
                if (body) sendOperatorMessage.mutate(body);
              }
            }}
            placeholder={
              isLive
                ? "Add to the conversation (Shift+Enter for newline)..."
                : meeting.state === "draft"
                  ? "Set the agenda or opening prompt — start the meeting to let the room reply."
                  : "Type a checkpoint message..."
            }
            rows={2}
            className="flex-1 min-w-0 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
          />
          <Button type="submit" size="sm" disabled={!composer.trim() || sendOperatorMessage.isPending}>
            <Send className="size-3" />
            Send
          </Button>
        </form>
      </div>
    </div>
  );
}
