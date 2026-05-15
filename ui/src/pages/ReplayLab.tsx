import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Repeat } from "lucide-react";
import { SUPPORTED_ARENA_MODELS } from "@nessie/shared";
import { replayLabApi, type ReplayRun } from "../api/replayLab";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useInvalidateOnLiveEvent } from "../hooks/useInvalidateOnLiveEvent";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import { StackPanel, StackChip, StackKpi } from "@/components/stack";
import { formatCents, formatNumber } from "../lib/utils";
import { SnippetPicker } from "../components/SnippetPicker";

const ACCENT = "#7C5CFF";

function statusColor(status: string): string {
  if (status === "completed") return "#27D17F";
  if (status === "running") return "#FFB400";
  return "#FF4F4F";
}

export default function ReplayLab() {
  const { selectedCompanyId: companyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const qc = useQueryClient();
  const [draftModel, setDraftModel] = useState<string>(SUPPORTED_ARENA_MODELS[0]);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftSystemPrompt, setDraftSystemPrompt] = useState("");
  const [originalRunId, setOriginalRunId] = useState("");
  const [selectedReplayId, setSelectedReplayId] = useState<string | null>(null);
  const [sourceLoadError, setSourceLoadError] = useState<string | null>(null);

  // Auto-prefill from the original heartbeat run when the operator
  // pastes / picks a runId. Best-effort: model + systemPrompt come from
  // the agent's current adapterConfig; the prompt hint comes from the
  // run's contextSnapshot or stdoutExcerpt.
  useEffect(() => {
    if (!companyId) return;
    const trimmed = originalRunId.trim();
    if (!trimmed) {
      setSourceLoadError(null);
      return;
    }
    let cancelled = false;
    setSourceLoadError(null);
    replayLabApi
      .source(trimmed, companyId)
      .then(({ source }) => {
        if (cancelled) return;
        if (source.model && SUPPORTED_ARENA_MODELS.includes(source.model as never)) {
          setDraftModel(source.model);
        }
        if (source.systemPrompt) setDraftSystemPrompt(source.systemPrompt);
        if (source.promptHint) setDraftPrompt(source.promptHint);
      })
      .catch((err) => {
        if (cancelled) return;
        setSourceLoadError(err instanceof Error ? err.message : "source not found");
      });
    return () => { cancelled = true; };
  }, [originalRunId, companyId]);

  useEffect(() => {
    setBreadcrumbs([{ label: "Replay" }]);
  }, [setBreadcrumbs]);

  // Live-event bridge: refresh the replay list as new replays land
  // (anywhere, including from other tabs / agent-callable invocations
  // in v2). Pure data invalidation; no optimistic UI required.
  useInvalidateOnLiveEvent({
    companyId: companyId ?? null,
    mapping: {
      "replay.completed": [["replay-runs", companyId]],
    },
  });

  const listQuery = useQuery({
    queryKey: ["replay-runs", companyId],
    queryFn: () => (companyId ? replayLabApi.list(companyId) : Promise.resolve({ replays: [] })),
    enabled: Boolean(companyId),
  });
  const replays: ReplayRun[] = listQuery.data?.replays ?? [];

  const detailQuery = useQuery({
    queryKey: ["replay-run", selectedReplayId, companyId],
    queryFn: () => {
      if (!selectedReplayId || !companyId) return Promise.resolve(null);
      return replayLabApi.get(selectedReplayId, companyId);
    },
    enabled: Boolean(selectedReplayId && companyId),
  });

  const create = useMutation({
    mutationFn: () => {
      if (!companyId) throw new Error("no company");
      return replayLabApi.create({
        companyId,
        overrideModel: draftModel,
        overridePrompt: draftPrompt,
        overrideSystemPrompt: draftSystemPrompt || null,
        originalRunId: originalRunId || null,
      });
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["replay-runs", companyId] });
      setSelectedReplayId(data.replay.id);
    },
  });

  const selected = useMemo(
    () => replays.find((r) => r.id === selectedReplayId) ?? null,
    [replays, selectedReplayId],
  );

  return (
    <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-[300px_1fr]">
      <div className="flex flex-col gap-4">
        <StackPanel
          color={ACCENT}
          title={
            <span className="flex items-center gap-2">
              <Repeat className="h-4 w-4" />
              New Replay
            </span>
          }
        >
          <div className="flex flex-col gap-3 p-3 text-xs">
            <label className="flex flex-col gap-1">
              <span className="font-mono uppercase tracking-wider text-muted-foreground">
                model
              </span>
              <select
                value={draftModel}
                onChange={(e) => setDraftModel(e.target.value)}
                className="rounded-md border bg-background px-2 py-1.5"
              >
                {SUPPORTED_ARENA_MODELS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono uppercase tracking-wider text-muted-foreground">
                original heartbeat run id (optional · auto-prefills)
              </span>
              <input
                type="text"
                value={originalRunId}
                onChange={(e) => setOriginalRunId(e.target.value)}
                placeholder="uuid"
                className="rounded-md border bg-background px-2 py-1.5 font-mono text-[11px]"
              />
              {sourceLoadError && (
                <span className="text-[10px] text-rose-700">{sourceLoadError}</span>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-mono uppercase tracking-wider text-muted-foreground">
                system prompt (optional)
              </span>
              <textarea
                rows={3}
                value={draftSystemPrompt}
                onChange={(e) => setDraftSystemPrompt(e.target.value)}
                className="rounded-md border bg-background px-2 py-1.5 font-mono text-[11px]"
              />
            </label>
            <label className="flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="font-mono uppercase tracking-wider text-muted-foreground">
                  prompt
                </span>
                <SnippetPicker
                  companyId={companyId ?? null}
                  onPick={(s) => setDraftPrompt(draftPrompt ? `${draftPrompt}\n\n${s.body}` : s.body)}
                />
              </div>
              <textarea
                rows={6}
                value={draftPrompt}
                onChange={(e) => setDraftPrompt(e.target.value)}
                className="rounded-md border bg-background px-2 py-1.5 font-mono text-[11px]"
              />
            </label>
            {create.error && (
              <div className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-rose-900">
                {(create.error as Error).message}
              </div>
            )}
            <Button
              size="sm"
              disabled={!draftPrompt.trim() || create.isPending}
              onClick={() => create.mutate()}
            >
              {create.isPending ? "Running…" : "Run replay"}
            </Button>
          </div>
        </StackPanel>

        <StackPanel color={ACCENT} title={<span>History</span>}>
          {replays.length === 0 ? (
            <EmptyState
              icon={Repeat}
              message="No replays yet. Paste a past heartbeat run id above to auto-prefill, then swap the model to compare cheap vs expensive output."
            />
          ) : (
            <ul className="flex flex-col gap-1 p-2">
              {replays.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedReplayId(r.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs ${
                      r.id === selectedReplayId ? "bg-[#0d0c10] text-white" : "hover:bg-muted"
                    }`}
                  >
                    <span className="truncate font-mono">{r.overrideModel}</span>
                    <StackChip color={statusColor(r.status)}>{r.status}</StackChip>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </StackPanel>
      </div>

      <div className="flex flex-col gap-4">
        {selected ? (
          <StackPanel
            color={ACCENT}
            title={
              <span className="flex items-center gap-2">
                {selected.overrideModel}
                <StackChip color={statusColor(selected.status)}>{selected.status}</StackChip>
              </span>
            }
          >
            <div className="flex flex-col gap-4 p-4 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <StackKpi label="cost" big={formatCents(selected.costCents)} color={ACCENT} />
                <StackKpi
                  label="latency"
                  big={selected.latencyMs != null ? `${selected.latencyMs} ms` : "—"}
                  color="#FFB400"
                />
                <StackKpi
                  label="tokens"
                  big={`${formatNumber(selected.inputTokens)} / ${formatNumber(selected.outputTokens)}`}
                  color="#1FA7FF"
                />
              </div>
              <details>
                <summary className="cursor-pointer font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                  prompt
                </summary>
                <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-mono text-[11px]">
                  {selected.overridePrompt}
                </pre>
              </details>
              {selected.overrideSystemPrompt && (
                <details>
                  <summary className="cursor-pointer font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                    system prompt
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-mono text-[11px]">
                    {selected.overrideSystemPrompt}
                  </pre>
                </details>
              )}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <div>
                  <div className="mb-1 font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                    replay output
                  </div>
                  {selected.errorMessage ? (
                    <div className="rounded-md border border-rose-300 bg-rose-50 px-2 py-1 text-rose-900">
                      {selected.errorCode}: {selected.errorMessage}
                    </div>
                  ) : (
                    <pre className="whitespace-pre-wrap rounded-md border bg-background p-3 font-mono text-[11px]">
                      {selected.outputText ?? "(no output)"}
                    </pre>
                  )}
                </div>
                <div>
                  <div className="mb-1 font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                    original heartbeat run
                  </div>
                  <pre className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 font-mono text-[11px]">
                    {detailQuery.data?.original
                      ? JSON.stringify(detailQuery.data.original.resultJson, null, 2)
                      : selected.originalRunId
                        ? "(loading)"
                        : "(no original linked)"}
                  </pre>
                </div>
              </div>
            </div>
          </StackPanel>
        ) : (
          <EmptyState icon={Repeat} message="Pick a replay from the history, or run a new one on the left." />
        )}
      </div>
    </div>
  );
}
