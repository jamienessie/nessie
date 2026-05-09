import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import {
  trustLayerApi,
  BUS_KINDS,
  REPUTATION_DIMENSIONS,
  type BusKind,
  type BusMessage,
  type BusStatus,
  type BlackBoxScope,
  type ContractState,
  type WorkContract,
  type ReputationEvent,
  type BlackBoxRecord,
} from "../api/trustLayer";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";
import type { Agent } from "@nessie/shared";

const NO_COMPANY = "__none__";

type Tab = "bus" | "contracts" | "blackbox" | "reputation";

const TABS: Array<{ id: Tab; label: string }> = [
  { id: "bus", label: "Agent Bus" },
  { id: "contracts", label: "Work Contracts" },
  { id: "blackbox", label: "Black Box" },
  { id: "reputation", label: "Reputation" },
];

function busStatusTone(s: BusStatus) {
  switch (s) {
    case "pending": return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    case "delivered": return "bg-sky-500/15 text-sky-700 dark:text-sky-400";
    case "replied": return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "expired": return "bg-muted text-muted-foreground";
    case "dismissed": return "bg-muted text-muted-foreground";
  }
}

function contractStateTone(s: ContractState) {
  switch (s) {
    case "draft": return "bg-muted text-muted-foreground";
    case "accepted": return "bg-sky-500/15 text-sky-700 dark:text-sky-400";
    case "in_progress": return "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400";
    case "submitted": return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    case "approved": return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "rejected": return "bg-destructive/15 text-destructive";
    case "abandoned": return "bg-muted text-muted-foreground";
  }
}

function BusPanel({ companyId, agents }: { companyId: string; agents: Agent[] }) {
  const [kind, setKind] = useState<BusKind | "">("");
  const [status, setStatus] = useState<BusStatus | "">("");
  const queryClient = useQueryClient();
  const agentMap = new Map(agents.map((a) => [a.id, a.name] as const));

  const { data, isLoading, error } = useQuery({
    queryKey: ["bus", companyId, kind, status],
    queryFn: () => trustLayerApi.listBus(companyId, kind || undefined, status || undefined),
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, to }: { id: string; to: BusStatus }) =>
      trustLayerApi.setBusStatus(id, to),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bus", companyId] });
    },
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Kind
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as BusKind | "")}
            className="border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="">all</option>
            {BUS_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as BusStatus | "")}
            className="border border-border bg-background px-2 py-1 text-xs"
          >
            <option value="">all</option>
            <option value="pending">pending</option>
            <option value="delivered">delivered</option>
            <option value="replied">replied</option>
            <option value="expired">expired</option>
            <option value="dismissed">dismissed</option>
          </select>
        </label>
      </div>

      {isLoading && <PageSkeleton variant="list" />}
      {error && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : String(error)}
        </p>
      )}
      {data?.messages.length === 0 && (
        <EmptyState icon={ShieldCheck} message="No bus messages match the filter." />
      )}

      {data && data.messages.length > 0 && (
        <ul className="space-y-1">
          {data.messages.map((m: BusMessage) => (
            <li key={m.id} className="border border-border bg-card px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider bg-muted text-muted-foreground">
                  {m.kind}
                </span>
                <span className={`px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${busStatusTone(m.status)}`}>
                  {m.status}
                </span>
                <span className="flex-1 text-muted-foreground">
                  {m.fromAgentId ? (agentMap.get(m.fromAgentId) ?? m.fromAgentId.slice(0, 8)) : "—"}
                  <span className="mx-1">→</span>
                  {m.toAgentId ? (agentMap.get(m.toAgentId) ?? m.toAgentId.slice(0, 8)) : "operator"}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {new Date(m.createdAt).toLocaleString()}
                </span>
                {m.status !== "dismissed" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => statusMutation.mutate({ id: m.id, to: "dismissed" })}
                    disabled={statusMutation.isPending}
                  >
                    Dismiss
                  </Button>
                )}
              </div>
              <pre className="mt-1.5 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                {JSON.stringify(m.payload, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ContractsPanel({ agents }: { agents: Agent[] }) {
  const [issueId, setIssueId] = useState("");
  const [loaded, setLoaded] = useState<string | null>(null);
  const agentMap = new Map(agents.map((a) => [a.id, a.name] as const));

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["work-contract", loaded],
    queryFn: () => trustLayerApi.contractByIssue(loaded!),
    enabled: !!loaded,
    retry: false,
  });

  const transitionMutation = useMutation({
    mutationFn: ({ id, to }: { id: string; to: ContractState }) =>
      trustLayerApi.transitionContract(id, to),
    onSuccess: () => refetch(),
  });

  return (
    <div className="space-y-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (issueId.trim()) setLoaded(issueId.trim());
        }}
      >
        <input
          placeholder="Issue ID (UUID)"
          value={issueId}
          onChange={(e) => setIssueId(e.target.value)}
          className="flex-1 border border-border bg-background px-2 py-1.5 text-sm font-mono"
        />
        <Button type="submit" size="sm" disabled={!issueId.trim()}>Load contract</Button>
      </form>

      {!loaded && (
        <p className="text-xs text-muted-foreground italic">
          Paste an issue UUID to load its work contract. Each issue can have at most one contract.
        </p>
      )}
      {isLoading && <PageSkeleton variant="detail" />}
      {error && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : String(error)}
        </p>
      )}
      {data?.contract && <ContractView contract={data.contract} agentMap={agentMap} onTransition={(to) =>
        transitionMutation.mutate({ id: data.contract.id, to })
      } isPending={transitionMutation.isPending} />}
    </div>
  );
}

function ContractView({
  contract,
  agentMap,
  onTransition,
  isPending,
}: {
  contract: WorkContract;
  agentMap: Map<string, string>;
  onTransition: (to: ContractState) => void;
  isPending: boolean;
}) {
  const NEXT: Record<ContractState, ContractState[]> = {
    draft: ["accepted", "abandoned"],
    accepted: ["in_progress", "abandoned"],
    in_progress: ["submitted", "abandoned"],
    submitted: ["approved", "rejected"],
    approved: [],
    rejected: ["accepted"],
    abandoned: [],
  };
  return (
    <div className="border border-border bg-card p-4 space-y-3 text-xs">
      <div className="flex items-center gap-2">
        <span className={`px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${contractStateTone(contract.state)}`}>
          {contract.state}
        </span>
        <span className="text-muted-foreground">
          owner: {contract.ownerAgentId ? (agentMap.get(contract.ownerAgentId) ?? contract.ownerAgentId.slice(0, 8)) : "—"}
        </span>
        <span className="text-muted-foreground">
          reviewer: {contract.reviewerAgentId ? (agentMap.get(contract.reviewerAgentId) ?? contract.reviewerAgentId.slice(0, 8)) : "—"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {contract.budgetCents != null && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Budget</div>
            <div className="text-sm tabular-nums">{contract.budgetCents}¢</div>
          </div>
        )}
        {contract.deadlineAt && (
          <div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Deadline</div>
            <div className="text-sm tabular-nums">{new Date(contract.deadlineAt).toLocaleString()}</div>
          </div>
        )}
      </div>

      {contract.acceptanceCriteria.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Acceptance criteria</div>
          <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
            {JSON.stringify(contract.acceptanceCriteria, null, 2)}
          </pre>
        </div>
      )}

      {contract.evidence.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Evidence ({contract.evidence.length})
          </div>
          <ul className="mt-1 space-y-1">
            {contract.evidence.map((e, i) => (
              <li key={i} className="border border-border p-2">
                <div className="flex items-center gap-2">
                  <code className="text-[10px] font-mono uppercase tracking-wider">{e.kind}</code>
                  <span className="font-mono text-[11px] text-muted-foreground truncate">{e.ref}</span>
                </div>
                {e.summary && <p className="mt-0.5 text-muted-foreground leading-5">{e.summary}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {NEXT[contract.state].length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Transition →</span>
          {NEXT[contract.state].map((to) => (
            <Button
              key={to}
              size="sm"
              variant={to === "abandoned" || to === "rejected" ? "ghost" : "outline"}
              onClick={() => onTransition(to)}
              disabled={isPending}
            >
              {to.replaceAll("_", " ")}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

function BlackBoxPanel() {
  const [scope, setScope] = useState<BlackBoxScope>("run");
  const [scopeId, setScopeId] = useState("");
  const [loaded, setLoaded] = useState<{ scope: BlackBoxScope; scopeId: string } | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ["black-box", loaded?.scope, loaded?.scopeId],
    queryFn: () => trustLayerApi.listBlackBox(loaded!.scope, loaded!.scopeId),
    enabled: !!loaded,
  });

  return (
    <div className="space-y-3">
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (scopeId.trim()) setLoaded({ scope, scopeId: scopeId.trim() });
        }}
      >
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as BlackBoxScope)}
          className="border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="run">run</option>
          <option value="meeting">meeting</option>
          <option value="hire">hire</option>
          <option value="incident">incident</option>
          <option value="decision">decision</option>
        </select>
        <input
          placeholder="Scope ID (UUID)"
          value={scopeId}
          onChange={(e) => setScopeId(e.target.value)}
          className="flex-1 border border-border bg-background px-2 py-1.5 text-sm font-mono"
        />
        <Button type="submit" size="sm" disabled={!scopeId.trim()}>Load records</Button>
      </form>

      {!loaded && (
        <p className="text-xs text-muted-foreground italic">
          Black-box records are append-only forensic snapshots scoped to a specific run, meeting,
          hire, incident, or decision. Pick a scope and paste its UUID.
        </p>
      )}
      {isLoading && <PageSkeleton variant="list" />}
      {error && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : String(error)}
        </p>
      )}
      {data?.records.length === 0 && (
        <EmptyState icon={ShieldCheck} message="No black-box records for that scope." />
      )}
      {data && data.records.length > 0 && (
        <ul className="space-y-1">
          {data.records.map((r: BlackBoxRecord) => (
            <li key={r.id} className="border border-border bg-card px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                  {r.label ?? "(no label)"}
                </span>
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {new Date(r.createdAt).toLocaleString()}
                </span>
              </div>
              <pre className="mt-1.5 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                {JSON.stringify(r.snapshot, null, 2)}
              </pre>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReputationPanel({ agents }: { agents: Agent[] }) {
  const [agentId, setAgentId] = useState("");
  const { data, isLoading, error } = useQuery({
    queryKey: ["reputation", agentId],
    queryFn: () => trustLayerApi.listReputation(agentId),
    enabled: !!agentId,
  });

  const totals: Record<string, number> = {};
  for (const ev of data?.events ?? []) {
    totals[ev.dimension] = (totals[ev.dimension] ?? 0) + ev.delta;
  }

  return (
    <div className="space-y-3">
      <select
        value={agentId}
        onChange={(e) => setAgentId(e.target.value)}
        className="w-full border border-border bg-background px-2 py-1.5 text-sm"
      >
        <option value="">Pick an agent…</option>
        {agents.map((a) => (
          <option key={a.id} value={a.id}>{a.name}</option>
        ))}
      </select>

      {!agentId && (
        <p className="text-xs text-muted-foreground italic">
          Reputation events accumulate per agent across six dimensions: speed, quality, cost,
          reliability, judgment, collaboration.
        </p>
      )}
      {isLoading && <PageSkeleton variant="list" />}
      {error && (
        <p className="text-sm text-destructive">
          {error instanceof Error ? error.message : String(error)}
        </p>
      )}

      {agentId && data && (
        <>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {REPUTATION_DIMENSIONS.map((d) => {
              const v = totals[d] ?? 0;
              const tone = v > 0 ? "text-emerald-600 dark:text-emerald-400"
                : v < 0 ? "text-destructive"
                : "text-muted-foreground";
              return (
                <div key={d} className="border border-border p-2 text-center">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">{d}</div>
                  <div className={`mt-1 text-lg font-semibold tabular-nums ${tone}`}>
                    {v > 0 ? "+" : ""}{v}
                  </div>
                </div>
              );
            })}
          </div>

          {data.events.length === 0 ? (
            <EmptyState icon={ShieldCheck} message="No reputation events yet." />
          ) : (
            <ul className="space-y-1">
              {data.events.map((ev: ReputationEvent) => (
                <li key={ev.id} className="border border-border bg-card px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className="px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider bg-muted">
                      {ev.dimension}
                    </span>
                    <span className={`font-mono text-sm tabular-nums ${
                      ev.delta > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                    }`}>
                      {ev.delta > 0 ? "+" : ""}{ev.delta}
                    </span>
                    <span className="flex-1 text-muted-foreground">{ev.reason}</span>
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {new Date(ev.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {ev.evidenceRef && (
                    <code className="mt-1 block font-mono text-[10px] text-muted-foreground">
                      ref: {ev.evidenceRef}
                    </code>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

export function TrustLayer() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const companyId = selectedCompanyId ?? NO_COMPANY;
  const [tab, setTab] = useState<Tab>("bus");

  useEffect(() => {
    setBreadcrumbs([{ label: "Trust Layer" }]);
  }, [setBreadcrumbs]);

  const { data: agents } = useQuery({
    queryKey: ["agents", companyId],
    queryFn: () => agentsApi.list(companyId),
    enabled: !!selectedCompanyId,
  });

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a company first.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
              tab === t.id
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "bus" && <BusPanel companyId={companyId} agents={agents ?? []} />}
      {tab === "contracts" && <ContractsPanel agents={agents ?? []} />}
      {tab === "blackbox" && <BlackBoxPanel />}
      {tab === "reputation" && <ReputationPanel agents={agents ?? []} />}
    </div>
  );
}
