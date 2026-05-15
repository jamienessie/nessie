import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trophy, Swords, Check, ChevronRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { tournamentsApi, type TournamentState } from "../api/tournaments";
import { agentsApi } from "../api/agents";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

interface IssueTournamentPanelProps {
  issueRef: string;
  companyId: string;
}

/**
 * Agent Tournaments — best-of-N. Issue gets N contestants tackling it in
 * parallel; a winner is picked (manually for MVP, by a judge agent later).
 *
 * MVP scope: persist tournament structure, allow operator to seed
 * contestants, paste contestant submissions, and pick a winner. Real
 * heartbeat invocation of contestants is intentionally deferred — see
 * server/src/services/tournaments.ts.
 */
export function IssueTournamentPanel({ issueRef, companyId }: IssueTournamentPanelProps) {
  const queryClient = useQueryClient();

  const { data: tournament } = useQuery({
    queryKey: ["issue-tournament", issueRef],
    queryFn: () => tournamentsApi.get(issueRef),
    enabled: !!issueRef,
  });

  const { data: agentList } = useQuery({
    queryKey: queryKeys.agents.list(companyId),
    queryFn: () => agentsApi.list(companyId),
    enabled: !!companyId,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["issue-tournament", issueRef] });

  if (!tournament) {
    return (
      <StartTournamentCard
        agents={agentList ?? []}
        onStart={async (contestantIds) => {
          await tournamentsApi.start(issueRef, contestantIds);
          refresh();
        }}
      />
    );
  }

  return <RunningTournamentCard tournament={tournament} agents={agentList ?? []} issueRef={issueRef} onRefresh={refresh} />;
}

interface StartTournamentCardProps {
  agents: { id: string; name: string; title?: string | null }[];
  onStart: (contestantIds: string[]) => Promise<void>;
}

function StartTournamentCard({ agents, onStart }: StartTournamentCardProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const start = async () => {
    if (selected.size < 2) {
      setError("Pick at least 2 contestants.");
      return;
    }
    setIsStarting(true);
    setError(null);
    try {
      await onStart(Array.from(selected));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start tournament");
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <div className="border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-start gap-3">
        <div className="rounded-md p-2 bg-muted/40">
          <Swords className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold">Agent Tournament</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Send N agents at this issue in parallel; pick the winner. With free agents you may as
            well try every angle.
          </p>
        </div>
      </div>

      <div>
        <p className="text-[10px] font-mono uppercase text-muted-foreground mb-1.5">Contestants</p>
        <div className="grid sm:grid-cols-2 gap-1.5 max-h-64 overflow-y-auto">
          {agents.length === 0 && (
            <p className="text-xs text-muted-foreground">No agents in this company yet.</p>
          )}
          {agents.map((agent) => {
            const isOn = selected.has(agent.id);
            return (
              <button
                key={agent.id}
                type="button"
                onClick={() => toggle(agent.id)}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-sm border-[1.5px] border-[#0d0c10] px-2 py-1.5 text-xs text-left transition-colors",
                  isOn ? "bg-[#FFC83A]" : "bg-white hover:bg-[#FFF1B8]",
                )}
              >
                <span className="min-w-0 truncate">
                  <span className="font-semibold text-[#0d0c10]">{agent.name}</span>
                  {agent.title && <span className="text-[#5a525e]"> · {agent.title}</span>}
                </span>
                {isOn && <Check className="h-3 w-3 shrink-0" />}
              </button>
            );
          })}
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="flex justify-end items-center gap-2">
        <span className="text-[11px] font-mono text-muted-foreground">{selected.size} selected</span>
        <Button size="sm" onClick={start} disabled={isStarting || selected.size < 2} className="bg-[#0d0c10] text-white hover:bg-[#FF4D2E]">
          {isStarting ? (
            <span className="flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting…</span>
          ) : (
            <span>Start tournament</span>
          )}
        </Button>
      </div>
    </div>
  );
}

interface RunningTournamentCardProps {
  tournament: TournamentState;
  agents: { id: string; name: string; title?: string | null }[];
  issueRef: string;
  onRefresh: () => void;
}

function RunningTournamentCard({ tournament, agents, issueRef, onRefresh }: RunningTournamentCardProps) {
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-muted/30 border-b border-border">
        <Trophy className="h-4 w-4" />
        <h3 className="text-sm font-semibold">Tournament</h3>
        <span className="text-[10px] font-mono uppercase text-muted-foreground">
          {tournament.status} · {tournament.contestants.length} contestants
        </span>
        <span className="flex-1" />
        {tournament.winnerAgentId && (
          <span className="rounded-sm bg-[#FFC83A] px-1.5 py-0.5 text-[9px] font-extrabold uppercase">
            winner: {agentName(tournament.winnerAgentId)}
          </span>
        )}
      </div>
      <div className="divide-y divide-border">
        {tournament.contestants.map((c) => (
          <ContestantRow
            key={c.agentId}
            contestant={c}
            isWinner={tournament.winnerAgentId === c.agentId}
            isPickable={tournament.status !== "complete" && tournament.status !== "cancelled"}
            agentName={agentName(c.agentId)}
            issueRef={issueRef}
            onChange={onRefresh}
          />
        ))}
      </div>
    </div>
  );
}

interface ContestantRowProps {
  contestant: TournamentState["contestants"][number];
  isWinner: boolean;
  isPickable: boolean;
  agentName: string;
  issueRef: string;
  onChange: () => void;
}

function ContestantRow({ contestant, isWinner, isPickable, agentName, issueRef, onChange }: ContestantRowProps) {
  const [submission, setSubmission] = useState(contestant.submission ?? "");
  const [expanded, setExpanded] = useState(false);

  const submitMutation = useMutation({
    mutationFn: () => tournamentsApi.submit(issueRef, contestant.agentId, submission.trim()),
    onSuccess: onChange,
  });
  const winnerMutation = useMutation({
    mutationFn: () => tournamentsApi.pickWinner(issueRef, contestant.agentId),
    onSuccess: onChange,
  });

  return (
    <div className={cn("p-3 text-sm", isWinner && "bg-[#FFF1B8]/60")}>
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "rounded-sm px-1.5 py-0.5 text-[9px] font-extrabold uppercase",
            contestant.status === "submitted"
              ? "bg-[#A4D81F]"
              : contestant.status === "running"
              ? "bg-[#1FA7FF] text-white"
              : contestant.status === "withdrawn"
              ? "bg-[#FFD1C4]"
              : "bg-[#C2EED8]",
          )}
        >
          {contestant.status}
        </span>
        <span className="font-semibold flex-1 truncate">{agentName}</span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")} />
        </button>
      </div>
      {expanded && (
        <div className="mt-2 space-y-2">
          <Textarea
            value={submission}
            onChange={(e) => setSubmission(e.target.value)}
            placeholder={`Paste ${agentName}'s submission…`}
            rows={3}
            className="text-xs"
            disabled={!isPickable}
          />
          <div className="flex items-center justify-end gap-2">
            {isPickable && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => submitMutation.mutate()}
                  disabled={!submission.trim() || submitMutation.isPending}
                >
                  {submitMutation.isPending ? "Saving…" : "Save submission"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => winnerMutation.mutate()}
                  disabled={winnerMutation.isPending}
                  className="bg-[#FFC83A] text-[#0d0c10] hover:bg-[#FF4D2E] hover:text-white"
                >
                  {winnerMutation.isPending ? "Crowning…" : isWinner ? "Winner ★" : "Pick this winner"}
                </Button>
              </>
            )}
          </div>
          {contestant.submittedAt && (
            <p className="text-[10px] font-mono uppercase text-muted-foreground">
              Submitted {new Date(contestant.submittedAt).toLocaleString()}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
