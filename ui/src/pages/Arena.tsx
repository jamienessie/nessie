import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Swords } from "lucide-react";
import { SUPPORTED_ARENA_MODELS, DEFAULT_ARENA_JUDGE_MODEL } from "@nessie/shared";
import {
  arenaApi,
  type ArenaRun,
  type ArenaResult,
  type ArenaLeaderboardEntry,
} from "../api/arena";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useInvalidateOnLiveEvent } from "../hooks/useInvalidateOnLiveEvent";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import {
  StackPanel,
  StackChip,
  StackKpi,
  StackProgress,
} from "@/components/stack";
import { formatCents, formatNumber } from "../lib/utils";
import { SnippetPicker } from "../components/SnippetPicker";

const ACCENT = "#1FA7FF";
const TABS = ["Compose", "History", "Leaderboard"] as const;
type Tab = (typeof TABS)[number];

const DEFAULT_PICKED: string[] = [
  "t2:gpt-4o-mini",
  "t2:claude-3-5-sonnet",
  "t3:llama-3.1-70b",
  "t3:mixtral-8x7b",
];

function scoreColor(score: number | null): string {
  if (score == null) return "#cbd5e1";
  if (score >= 70) return "#27D17F";
  if (score >= 40) return "#FFB400";
  return "#FF4F4F";
}

function modelTierAccent(model: string): string {
  if (model.startsWith("t1:")) return "#FFE6B5";
  if (model.startsWith("t2:")) return "#DDD2FF";
  return "#C5F0FF";
}

function statusChipColor(status: string): string {
  if (status === "judged" || status === "completed") return "#27D17F";
  if (status === "running" || status === "pending") return "#FFB400";
  if (status === "cancelled") return "#cbd5e1";
  return "#FF4F4F";
}

export default function Arena() {
  const { selectedCompanyId: companyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("Compose");
  const [pinnedRunId, setPinnedRunId] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Arena" }]);
  }, [setBreadcrumbs]);

  // Live-event bridge: arena lifecycle events invalidate the matching
  // queries so cards update as each candidate settles.
  useInvalidateOnLiveEvent({
    companyId: companyId ?? null,
    mapping: {
      "arena.run.started": [["arena-runs", companyId]],
      "arena.run.result_landed": [["arena-runs", companyId]],
      "arena.run.judged": [["arena-runs", companyId], ["arena-leaderboard", companyId]],
      "arena.run.cancelled": [["arena-runs", companyId]],
      "arena.run.failed": [["arena-runs", companyId]],
    },
  });

  return (
    <div className="flex flex-col gap-4 p-4">
      <StackPanel
        title={
          <span className="flex items-center gap-2">
            <Swords className="h-4 w-4" />
            Model Arena
          </span>
        }
        color={ACCENT}
      >
        <div className="flex flex-wrap items-center gap-2 p-3">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md px-3 py-1.5 text-xs font-mono uppercase tracking-wider ${
                tab === t ? "bg-[#0d0c10] text-white" : "bg-muted text-muted-foreground hover:bg-muted-foreground/10"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </StackPanel>

      {tab === "Compose" && (
        <ComposeTab
          companyId={companyId ?? null}
          onCreated={(runId) => {
            setPinnedRunId(runId);
            setTab("History");
            qc.invalidateQueries({ queryKey: ["arena-runs", companyId] });
          }}
        />
      )}
      {tab === "History" && (
        <HistoryTab companyId={companyId ?? null} pinnedRunId={pinnedRunId} setPinnedRunId={setPinnedRunId} />
      )}
      {tab === "Leaderboard" && <LeaderboardTab companyId={companyId ?? null} />}
    </div>
  );
}

function ComposeTab({
  companyId,
  onCreated,
}: {
  companyId: string | null;
  onCreated: (runId: string) => void;
}) {
  const [taskType, setTaskType] = useState("summarize");
  const [prompt, setPrompt] = useState("");
  const [selectedModels, setSelectedModels] = useState<string[]>(DEFAULT_PICKED);
  const [judgeModel, setJudgeModel] = useState<string>(DEFAULT_ARENA_JUDGE_MODEL);

  const createMutation = useMutation({
    mutationFn: () => {
      if (!companyId) throw new Error("no company selected");
      return arenaApi.create({
        companyId,
        taskType,
        prompt,
        candidateModels: selectedModels,
        judgeModel,
      });
    },
    onSuccess: (data) => {
      setPrompt("");
      onCreated(data.run.id);
    },
  });

  function toggleModel(model: string) {
    setSelectedModels((prev) =>
      prev.includes(model) ? prev.filter((m) => m !== model) : [...prev, model],
    );
  }

  const canSubmit =
    companyId && taskType.trim() && prompt.trim() && selectedModels.length >= 2 && !createMutation.isPending;

  return (
    <StackPanel color={ACCENT} title={<span>Compose</span>}>
      <div className="flex flex-col gap-4 p-4">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">task type</span>
          <input
            type="text"
            value={taskType}
            onChange={(e) => setTaskType(e.target.value)}
            placeholder="summarize, refactor, classify…"
            className="rounded-md border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">prompt</span>
            <SnippetPicker
              companyId={companyId ?? null}
              onPick={(s) => setPrompt(prompt ? `${prompt}\n\n${s.body}` : s.body)}
            />
          </div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="The task prompt every candidate model will receive…"
            rows={6}
            className="rounded-md border bg-background px-3 py-2 text-sm font-mono"
          />
        </label>
        <div className="flex flex-col gap-2">
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
            candidate models · pick at least 2
          </span>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
            {SUPPORTED_ARENA_MODELS.map((model) => {
              const checked = selectedModels.includes(model);
              return (
                <button
                  key={model}
                  type="button"
                  onClick={() => toggleModel(model)}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-xs font-mono ${
                    checked ? "border-[#0d0c10] bg-[#0d0c10] text-white" : "border-border bg-background"
                  }`}
                >
                  <span>{model}</span>
                  <span
                    className="ml-2 inline-block h-2 w-2 rounded-full"
                    style={{ background: modelTierAccent(model) }}
                  />
                </button>
              );
            })}
          </div>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">judge model</span>
          <select
            value={judgeModel}
            onChange={(e) => setJudgeModel(e.target.value)}
            className="rounded-md border bg-background px-3 py-2 text-sm"
          >
            {[DEFAULT_ARENA_JUDGE_MODEL, ...SUPPORTED_ARENA_MODELS.filter((m) => m !== DEFAULT_ARENA_JUDGE_MODEL)].map(
              (m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ),
            )}
          </select>
        </label>
        {createMutation.error && (
          <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">
            {(createMutation.error as Error).message}
          </div>
        )}
        <div>
          <Button disabled={!canSubmit} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? "Launching…" : "Run Arena"}
          </Button>
        </div>
      </div>
    </StackPanel>
  );
}

function HistoryTab({
  companyId,
  pinnedRunId,
  setPinnedRunId,
}: {
  companyId: string | null;
  pinnedRunId: string | null;
  setPinnedRunId: (id: string | null) => void;
}) {
  const runsQuery = useQuery({
    queryKey: ["arena-runs", companyId],
    queryFn: () => (companyId ? arenaApi.list(companyId, { limit: 50 }) : Promise.resolve({ runs: [] })),
    enabled: Boolean(companyId),
  });
  const runs = runsQuery.data?.runs ?? [];
  const pinned = useMemo(() => runs.find((r) => r.id === pinnedRunId) ?? null, [runs, pinnedRunId]);

  // B5 cross-feature nudge: if there's a clear leaderboard winner for
  // the pinned run's taskType (or any judged run's task type), hint
  // about Auto-Router. Lightweight: shown once per task type with a
  // judged winner.
  const judgedTaskTypes = useMemo(() => {
    const seen = new Set<string>();
    for (const r of runs) {
      if (r.status === "judged" && r.winnerModel) seen.add(r.taskType);
    }
    return Array.from(seen);
  }, [runs]);

  return (
    <div className="flex flex-col gap-4">
      {judgedTaskTypes.length > 0 && (
        <StackPanel color="#22C2A4" title={<span>Suggestion</span>}>
          <div className="flex flex-col gap-2 p-3 text-xs">
            <div>
              You have judged Arena winners for{" "}
              <span className="font-mono">{judgedTaskTypes.join(", ")}</span>.
            </div>
            <div>
              Flip <span className="font-mono">Auto-Router</span> on for agents whose role matches one of these task types
              (Behaviors page) so future heartbeat runs use the proven winner automatically.
              Auto-Router also falls back to <span className="font-mono">"general"</span> and company-wide leaderboards.
            </div>
          </div>
        </StackPanel>
      )}
      {runsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading runs…</p>
      ) : runs.length === 0 ? (
        <EmptyState
          icon={Swords}
          message='No arena runs yet. Try a 3-model "summarize" challenge from the Compose tab — picks the cheapest model that gives the same answer.'
        />
      ) : (
        <>
          <RunList runs={runs} pinnedRunId={pinnedRunId} onPin={setPinnedRunId} />
          {pinned && <RunDetail run={pinned} companyId={companyId} />}
        </>
      )}
    </div>
  );
}

function RunList({
  runs,
  pinnedRunId,
  onPin,
}: {
  runs: ArenaRun[];
  pinnedRunId: string | null;
  onPin: (id: string | null) => void;
}) {
  return (
    <StackPanel color={ACCENT} title={<span>Runs</span>}>
      <ul className="flex flex-col gap-1 p-2">
        {runs.map((run) => {
          const active = run.id === pinnedRunId;
          return (
            <li key={run.id}>
              <button
                type="button"
                onClick={() => onPin(active ? null : run.id)}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-xs font-mono ${
                  active ? "bg-[#0d0c10] text-white" : "hover:bg-muted"
                }`}
              >
                <StackChip color={statusChipColor(run.status)}>{run.status}</StackChip>
                <span className="flex-1 truncate">{run.taskType} · {run.candidateModels.length} models</span>
                {run.winnerModel && <span className="opacity-70">🏆 {run.winnerModel}</span>}
                <span className="opacity-70">{new Date(run.createdAt).toLocaleString()}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </StackPanel>
  );
}

function RunDetail({ run, companyId }: { run: ArenaRun; companyId: string | null }) {
  const qc = useQueryClient();
  const cancelMutation = useMutation({
    mutationFn: () => {
      if (!companyId) throw new Error("no company");
      return arenaApi.cancel(run.id, companyId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["arena-runs", companyId] });
    },
  });
  return (
    <StackPanel
      color={ACCENT}
      title={
        <span className="flex items-center gap-2">
          {run.taskType}
          <StackChip color={statusChipColor(run.status)}>{run.status}</StackChip>
          {run.winnerModel && <StackChip color="#27D17F">🏆 {run.winnerModel}</StackChip>}
        </span>
      }
      right={
        run.status === "running" ? (
          <Button
            size="sm"
            variant="outline"
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            {cancelMutation.isPending ? "Cancelling…" : "Cancel"}
          </Button>
        ) : null
      }
    >
      <div className="flex flex-col gap-3 p-3">
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <StackKpi label="candidates" big={formatNumber(run.candidateModels.length)} color={ACCENT} />
          <StackKpi label="judge" big={<span className="text-sm">{run.judgeModel}</span>} color="#7C5CFF" />
          <StackKpi label="total spend" big={formatCents(run.totalCostCents)} color="#FFB400" />
          <StackKpi
            label="status"
            big={<span className="text-sm">{run.status}</span>}
            color={statusChipColor(run.status)}
          />
        </div>
        <details className="rounded-md bg-muted/40 p-2 text-xs">
          <summary className="cursor-pointer font-mono uppercase tracking-wider">prompt</summary>
          <pre className="mt-2 whitespace-pre-wrap font-mono">{run.prompt}</pre>
        </details>
        {run.judgeError && (
          <div className="rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-900">
            judge error: {run.judgeError}
          </div>
        )}
        {run.judgeNotes && (
          <div className="rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
            judge: {run.judgeNotes}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {run.results
            .slice()
            .sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.model.localeCompare(b.model))
            .map((result) => (
              <ResultCard key={result.id} result={result} isWinner={result.model === run.winnerModel} />
            ))}
        </div>
      </div>
    </StackPanel>
  );
}

function ResultCard({ result, isWinner }: { result: ArenaResult; isWinner: boolean }) {
  return (
    <StackPanel
      color={modelTierAccent(result.model)}
      title={
        <span className="flex items-center gap-2 text-xs font-mono">
          {result.model}
          {isWinner && <StackChip color="#27D17F">🏆 winner</StackChip>}
        </span>
      }
      right={<StackChip color={statusChipColor(result.status)}>{result.status}</StackChip>}
    >
      <div className="flex flex-col gap-2 p-3 text-xs">
        <div className="grid grid-cols-3 gap-2">
          <div>
            <div className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">cost</div>
            <div className="font-semibold">{formatCents(result.costCents)}</div>
          </div>
          <div>
            <div className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">latency</div>
            <div className="font-semibold">{result.latencyMs != null ? `${result.latencyMs} ms` : "—"}</div>
          </div>
          <div>
            <div className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">tokens</div>
            <div className="font-semibold">
              {formatNumber(result.inputTokens)} / {formatNumber(result.outputTokens)}
            </div>
          </div>
        </div>
        {result.score != null && (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">judge score</span>
              <span className="font-semibold">{result.score} / 100</span>
            </div>
            <StackProgress value={result.score / 100} color={scoreColor(result.score)} />
          </div>
        )}
        {result.judgeReasoning && (
          <div className="rounded-md bg-muted/40 p-2 text-[11px]">{result.judgeReasoning}</div>
        )}
        {result.errorMessage && (
          <div className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-900">
            {result.errorCode}: {result.errorMessage}
          </div>
        )}
        {result.outputText && (
          <details className="text-[11px]">
            <summary className="cursor-pointer font-mono uppercase tracking-wider">output</summary>
            <pre className="mt-2 whitespace-pre-wrap font-mono">{result.outputText}</pre>
          </details>
        )}
      </div>
    </StackPanel>
  );
}

function LeaderboardTab({ companyId }: { companyId: string | null }) {
  const [taskTypeFilter, setTaskTypeFilter] = useState("");
  const lbQuery = useQuery({
    queryKey: ["arena-leaderboard", companyId, taskTypeFilter],
    queryFn: () => {
      if (!companyId) return Promise.resolve({ entries: [] as ArenaLeaderboardEntry[] });
      return arenaApi.leaderboard(companyId, { taskType: taskTypeFilter || undefined });
    },
    enabled: Boolean(companyId),
  });
  const entries = lbQuery.data?.entries ?? [];

  return (
    <StackPanel color={ACCENT} title={<span>Leaderboard</span>}>
      <div className="flex flex-col gap-3 p-3">
        <label className="flex items-center gap-2 text-xs">
          <span className="font-mono uppercase tracking-wider text-muted-foreground">filter by task type</span>
          <input
            type="text"
            value={taskTypeFilter}
            onChange={(e) => setTaskTypeFilter(e.target.value)}
            placeholder="(any)"
            className="rounded-md border bg-background px-2 py-1 text-xs"
          />
        </label>
        {entries.length === 0 ? (
          <EmptyState icon={Swords} message="No judged runs yet." />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="px-2 py-2 text-left font-mono uppercase tracking-wider text-muted-foreground">model</th>
                <th className="px-2 py-2 text-right font-mono uppercase tracking-wider text-muted-foreground">wins</th>
                <th className="px-2 py-2 text-right font-mono uppercase tracking-wider text-muted-foreground">avg score</th>
                <th className="px-2 py-2 text-right font-mono uppercase tracking-wider text-muted-foreground">runs scored</th>
                <th className="px-2 py-2 text-right font-mono uppercase tracking-wider text-muted-foreground">total spend</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.model} className="border-b last:border-0">
                  <td className="px-2 py-2 font-mono">{e.model}</td>
                  <td className="px-2 py-2 text-right font-semibold">{formatNumber(e.wins)}</td>
                  <td className="px-2 py-2 text-right">{e.avgScore}</td>
                  <td className="px-2 py-2 text-right">{formatNumber(e.runsScored)}</td>
                  <td className="px-2 py-2 text-right">{formatCents(e.totalCostCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </StackPanel>
  );
}
