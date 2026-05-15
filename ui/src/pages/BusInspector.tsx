import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Radio } from "lucide-react";
import {
  busApi,
  BUS_KINDS,
  BUS_STATUSES,
  type BusKind,
  type BusMessage,
  type BusStatus,
} from "../api/bus";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import { StackPanel, StackChip } from "@/components/stack";
import { AgentLabel } from "../components/AgentLabel";

const ACCENT = "#22C2A4";

function kindAccent(kind: string): string {
  if (kind === "operator_approval_request") return "#FFB400";
  if (kind === "policy_check") return "#FF6B9A";
  if (kind === "incident_escalation") return "#FF4F4F";
  if (kind === "review_request") return "#7C5CFF";
  if (kind === "hiring_request") return "#5B8DEF";
  return "#1FA7FF";
}

export default function BusInspector() {
  const { selectedCompanyId: companyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const qc = useQueryClient();
  const [kindFilter, setKindFilter] = useState<BusKind | "all">("all");
  const [statusFilter, setStatusFilter] = useState<BusStatus | "all">("all");

  useEffect(() => {
    setBreadcrumbs([{ label: "Bus" }]);
  }, [setBreadcrumbs]);

  const messagesQuery = useQuery({
    queryKey: ["bus-messages", companyId, kindFilter, statusFilter],
    queryFn: () => {
      if (!companyId) return Promise.resolve({ messages: [] });
      return busApi.list(companyId, {
        kind: kindFilter === "all" ? undefined : kindFilter,
        status: statusFilter === "all" ? undefined : statusFilter,
      });
    },
    enabled: Boolean(companyId),
  });

  const agentsQuery = useQuery({
    queryKey: ["bus-agents", companyId],
    queryFn: () => (companyId ? agentsApi.list(companyId) : Promise.resolve([])),
    enabled: Boolean(companyId),
  });

  const agentById = new Map<string, { id: string; name: string; title?: string | null }>();
  for (const a of agentsQuery.data ?? []) {
    agentById.set(a.id, { id: a.id, name: a.name, title: a.title });
  }

  const dismissMutation = useMutation({
    mutationFn: (messageId: string) => busApi.markStatus(messageId, "dismissed"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["bus-messages", companyId] });
    },
  });

  const messages: BusMessage[] = messagesQuery.data?.messages ?? [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <StackPanel
        title={
          <span className="flex items-center gap-2">
            <Radio className="h-4 w-4" />
            Agent Bus
          </span>
        }
        color={ACCENT}
      >
        <div className="flex flex-wrap items-center gap-3 p-3">
          <label className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted-foreground">
            kind
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as BusKind | "all")}
              className="rounded-md border bg-background px-2 py-1 text-xs"
            >
              <option value="all">all</option>
              {BUS_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5 text-xs font-mono uppercase tracking-wider text-muted-foreground">
            status
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as BusStatus | "all")}
              className="rounded-md border bg-background px-2 py-1 text-xs"
            >
              <option value="all">all</option>
              {BUS_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
        </div>
      </StackPanel>

      {messagesQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading messages…</p>
      ) : messages.length === 0 ? (
        <EmptyState icon={Radio} message="No bus messages match the current filter." />
      ) : (
        <ul className="flex flex-col gap-2">
          {messages.map((msg) => {
            const from = msg.fromAgentId ? agentById.get(msg.fromAgentId) : null;
            const to = msg.toAgentId ? agentById.get(msg.toAgentId) : null;
            return (
              <li key={msg.id}>
                <StackPanel
                  color={kindAccent(msg.kind)}
                  title={
                    <span className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider">
                      {msg.kind}
                      <StackChip>{msg.status}</StackChip>
                    </span>
                  }
                  right={
                    msg.status === "pending" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={dismissMutation.isPending}
                        onClick={() => dismissMutation.mutate(msg.id)}
                      >
                        Dismiss
                      </Button>
                    ) : null
                  }
                >
                  <div className="flex flex-col gap-2 p-3">
                    <div className="flex items-center gap-3 text-xs">
                      <span className="text-muted-foreground">from:</span>
                      {from ? <AgentLabel agent={from} size="sm" /> : <span className="font-mono">{msg.fromAgentId ?? "operator"}</span>}
                      <span className="text-muted-foreground">→ to:</span>
                      {to ? <AgentLabel agent={to} size="sm" /> : <span className="font-mono">{msg.toAgentId ?? "(broadcast)"}</span>}
                    </div>
                    <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-[11px] font-mono">
                      {JSON.stringify(msg.payload, null, 2)}
                    </pre>
                  </div>
                </StackPanel>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
