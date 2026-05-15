import { useEffect, useMemo, useState } from "react";
import { useParams } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Sliders } from "lucide-react";
import { SUPPORTED_ARENA_MODELS, DEFAULT_ARENA_JUDGE_MODEL } from "@nessie/shared";
import { agentBehaviorsApi, type AgentBehaviors } from "../api/agentBehaviors";
import { agentPreviewApi } from "../api/agentPreview";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useInvalidateOnLiveEvent } from "../hooks/useInvalidateOnLiveEvent";
import { Button } from "@/components/ui/button";
import { StackPanel, StackChip } from "@/components/stack";
import { AgentLabel } from "../components/AgentLabel";

const ACCENT = "#22C2A4";

function Toggle({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string;
  description: string;
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-start gap-3 rounded-md border bg-background p-3">
      <input
        type="checkbox"
        checked={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4"
      />
      <div className="flex flex-col gap-1 text-xs">
        <span className="font-mono uppercase tracking-wider">{label}</span>
        <span className="text-muted-foreground">{description}</span>
      </div>
    </label>
  );
}

export default function AgentBehaviorsPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const { selectedCompanyId: companyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const qc = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([{ label: "Behaviors" }]);
  }, [setBreadcrumbs]);

  // Live-event bridge: if another tab updates the same agent's
  // behaviors, refresh ours so we don't post a stale write.
  useInvalidateOnLiveEvent({
    companyId: companyId ?? null,
    mapping: {
      "agent.behaviors_updated": [["agent-behaviors", agentId]],
    },
  });

  const behaviorsQuery = useQuery({
    queryKey: ["agent-behaviors", agentId, companyId],
    queryFn: () => {
      if (!agentId || !companyId) return Promise.resolve(null);
      return agentBehaviorsApi.get(agentId, companyId);
    },
    enabled: Boolean(agentId && companyId),
  });

  const agentsQuery = useQuery({
    queryKey: ["agent-behaviors-agent", companyId],
    queryFn: () => (companyId ? agentsApi.list(companyId) : Promise.resolve([])),
    enabled: Boolean(companyId),
  });
  const agent = (agentsQuery.data ?? []).find((a) => a.id === agentId) ?? null;

  const remote = behaviorsQuery.data?.behaviors ?? null;
  const [draft, setDraft] = useState<AgentBehaviors | null>(null);
  useEffect(() => { if (remote) setDraft(remote); }, [remote]);

  const update = useMutation({
    mutationFn: (next: AgentBehaviors) => {
      if (!agentId || !companyId) throw new Error("missing context");
      return agentBehaviorsApi.update(agentId, { companyId, ...next });
    },
    onSuccess: (data) => {
      setDraft(data.behaviors);
      qc.invalidateQueries({ queryKey: ["agent-behaviors", agentId] });
      qc.invalidateQueries({ queryKey: ["agent-preview", agentId] });
    },
  });

  const previewQuery = useQuery({
    queryKey: ["agent-preview", agentId, companyId],
    queryFn: () => {
      if (!agentId || !companyId) return Promise.resolve(null);
      return agentPreviewApi.fetch(agentId, companyId);
    },
    enabled: Boolean(agentId && companyId),
  });

  const preflightOverride = useMutation({
    mutationFn: (minutes: number) => {
      if (!agentId || !companyId) throw new Error("missing context");
      return agentPreviewApi.preflightOverride(agentId, { companyId, minutes });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agent-preview", agentId] });
      qc.invalidateQueries({ queryKey: ["agent-behaviors", agentId] });
    },
  });

  const dirty = useMemo(() => {
    if (!remote || !draft) return false;
    return JSON.stringify(remote) !== JSON.stringify(draft);
  }, [remote, draft]);

  if (!draft) {
    return <div className="p-4 text-sm text-muted-foreground">Loading behaviors…</div>;
  }

  function toggleConsensusModel(model: string) {
    setDraft((d) => {
      if (!d) return d;
      const current = d.consensus.models;
      const next = current.includes(model)
        ? current.filter((m) => m !== model)
        : [...current, model];
      return { ...d, consensus: { ...d.consensus, models: next } };
    });
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <StackPanel
        color={ACCENT}
        title={
          <span className="flex items-center gap-2">
            <Sliders className="h-4 w-4" />
            Behaviors
            {agent && <AgentLabel agent={agent} size="sm" />}
          </span>
        }
        right={
          <div className="flex items-center gap-2">
            {dirty && <StackChip color="#FFB400">unsaved</StackChip>}
            <Button
              size="sm"
              disabled={!dirty || update.isPending}
              onClick={() => update.mutate(draft)}
            >
              {update.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 p-4">
          <div className="text-xs text-muted-foreground">
            Behaviors stack: Pre-Flight runs first (gates the run), then
            Coaching Notes prepend, then Auto-Router / Consensus pick the
            model, then Self-Critic grades the output. Each can be enabled
            independently.
          </div>
          <Toggle
            label="Auto-Router"
            description="Heartbeat dispatch consults the Arena leaderboard for this agent's role and overrides the configured model with the proven winner (same-tier only, MIN_WINS=2)."
            value={draft.autoRouter}
            onChange={(v) => setDraft({ ...draft, autoRouter: v })}
          />
          <Toggle
            label="Pre-Flight Check"
            description="Before each run, verify workspace_present + git_clean + git_up_to_date. Failures abort the run before any token burns."
            value={draft.preFlight}
            onChange={(v) => setDraft({ ...draft, preFlight: v })}
          />
          <Toggle
            label="Output Self-Critic"
            description="After the primary call, ask the same model to grade its output against a 4-line rubric; retry once on fail. (Effective for openai-compatible adapter.)"
            value={draft.selfCritic}
            onChange={(v) => setDraft({ ...draft, selfCritic: v })}
          />
          <div className="rounded-md border bg-background p-3 text-xs">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={draft.consensus.enabled}
                onChange={(e) => setDraft({ ...draft, consensus: { ...draft.consensus, enabled: e.target.checked } })}
                className="mt-1 h-4 w-4"
              />
              <div className="flex flex-1 flex-col gap-2">
                <span className="font-mono uppercase tracking-wider">Consensus Mode</span>
                <span className="text-muted-foreground">
                  Fan the run out to N cheap models inline; the judge picks the
                  winner whose output becomes the agent's reply. Replaces the
                  single-model call entirely.
                </span>
                <div className="flex flex-col gap-1">
                  <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                    candidate models (pick at least 2)
                  </span>
                  <div className="grid grid-cols-2 gap-1 md:grid-cols-3">
                    {SUPPORTED_ARENA_MODELS.map((m) => {
                      const checked = draft.consensus.models.includes(m);
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => toggleConsensusModel(m)}
                          className={`flex items-center justify-between rounded-md border px-2 py-1 text-left text-[11px] font-mono ${
                            checked ? "border-[#0d0c10] bg-[#0d0c10] text-white" : "border-border bg-background"
                          }`}
                          disabled={!draft.consensus.enabled}
                        >
                          {m}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <label className="flex flex-col gap-1">
                  <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                    judge model
                  </span>
                  <select
                    disabled={!draft.consensus.enabled}
                    value={draft.consensus.judgeModel ?? DEFAULT_ARENA_JUDGE_MODEL}
                    onChange={(e) => setDraft({ ...draft, consensus: { ...draft.consensus, judgeModel: e.target.value } })}
                    className="rounded-md border bg-background px-2 py-1"
                  >
                    {[DEFAULT_ARENA_JUDGE_MODEL, ...SUPPORTED_ARENA_MODELS.filter((m) => m !== DEFAULT_ARENA_JUDGE_MODEL)].map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </label>
              </div>
            </label>
          </div>
        </div>
      </StackPanel>

      {previewQuery.data && (
        <StackPanel color="#7C5CFF" title={<span>Next-run preview</span>}>
          <div className="flex flex-col gap-3 p-4 text-xs">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <div className="flex flex-col gap-1 rounded-md border bg-background p-2">
                <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">resolved model</span>
                <span className="font-mono">{previewQuery.data.preview.resolvedModel ?? "(none)"}</span>
                <span className="text-[10px] text-muted-foreground">
                  {previewQuery.data.preview.routerSource === "leaderboard"
                    ? `via leaderboard · ${previewQuery.data.preview.routerReason ?? ""}`
                    : `configured · ${previewQuery.data.preview.routerReason ?? ""}`}
                </span>
              </div>
              <div className="flex flex-col gap-1 rounded-md border bg-background p-2">
                <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">configured model</span>
                <span className="font-mono">{previewQuery.data.preview.configuredModel ?? "(none)"}</span>
              </div>
            </div>
            <details>
              <summary className="cursor-pointer font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                assembled system prompt
              </summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-mono text-[11px]">
                {previewQuery.data.preview.assembledSystemPrompt ?? "(none)"}
              </pre>
            </details>
            <div className="rounded-md border bg-background p-2">
              <div className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                pre-flight override
              </div>
              <div className="mt-1 flex items-center gap-2">
                {previewQuery.data.preview.behaviors.preFlightOverrideUntil ? (
                  <span className="font-mono text-[11px]">
                    active until {new Date(previewQuery.data.preview.behaviors.preFlightOverrideUntil).toLocaleString()}
                  </span>
                ) : (
                  <span className="text-muted-foreground">no override active</span>
                )}
                <button
                  type="button"
                  onClick={() => preflightOverride.mutate(15)}
                  disabled={preflightOverride.isPending}
                  className="ml-auto rounded-md border bg-background px-2 py-1 text-[11px] font-mono"
                >
                  {preflightOverride.isPending ? "…" : "override 15m"}
                </button>
                <button
                  type="button"
                  onClick={() => preflightOverride.mutate(60)}
                  disabled={preflightOverride.isPending}
                  className="rounded-md border bg-background px-2 py-1 text-[11px] font-mono"
                >
                  {preflightOverride.isPending ? "…" : "override 1h"}
                </button>
              </div>
            </div>
          </div>
        </StackPanel>
      )}
    </div>
  );
}
