import { useEffect, useState } from "react";
import { useParams } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { coachingNotesApi, type CoachingNote } from "../api/coachingNotes";
import { agentsApi } from "../api/agents";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import { StackPanel, StackChip } from "@/components/stack";
import { AgentLabel } from "../components/AgentLabel";

const ACCENT = "#B872FF";

export default function CoachingNotes() {
  const { agentId } = useParams<{ agentId: string }>();
  const { selectedCompanyId: companyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const qc = useQueryClient();
  const [draft, setDraft] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Coaching" }]);
  }, [setBreadcrumbs]);

  const notesQuery = useQuery({
    queryKey: ["coaching-notes", agentId, companyId, showArchived],
    queryFn: () => {
      if (!agentId || !companyId) return Promise.resolve({ notes: [] });
      return coachingNotesApi.list(agentId, companyId, { includeArchived: showArchived });
    },
    enabled: Boolean(agentId && companyId),
  });

  const agentsQuery = useQuery({
    queryKey: ["coaching-agent", companyId],
    queryFn: () => (companyId ? agentsApi.list(companyId) : Promise.resolve([])),
    enabled: Boolean(companyId),
  });

  const create = useMutation({
    mutationFn: () => {
      if (!agentId || !companyId) throw new Error("missing context");
      return coachingNotesApi.create(agentId, { companyId, body: draft });
    },
    onSuccess: () => {
      setDraft("");
      qc.invalidateQueries({ queryKey: ["coaching-notes", agentId] });
    },
  });

  const archive = useMutation({
    mutationFn: (noteId: string) => {
      if (!companyId) throw new Error("missing context");
      return coachingNotesApi.archive(noteId, companyId);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["coaching-notes", agentId] });
    },
  });

  const notes: CoachingNote[] = notesQuery.data?.notes ?? [];
  const active = notes.filter((n) => n.status === "active");
  const archived = notes.filter((n) => n.status === "archived");
  const agent = (agentsQuery.data ?? []).find((a) => a.id === agentId) ?? null;

  return (
    <div className="flex flex-col gap-4 p-4">
      <StackPanel
        title={
          <span className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Coaching Notes
            {agent && <AgentLabel agent={agent} size="sm" />}
          </span>
        }
        color={ACCENT}
      >
        <div className="flex flex-col gap-3 p-4">
          <div className="text-xs text-muted-foreground">
            Active notes are prepended to this agent's system prompt on every run.
            Cheap models follow standing guidance less reliably than frontier
            models — write the things you'd otherwise repeat in every prompt.
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="e.g. prefer 3-bullet summaries over paragraphs"
            rows={3}
            className="rounded-md border bg-background px-3 py-2 text-sm font-mono"
          />
          <div className="flex items-center gap-2">
            <Button disabled={!draft.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Adding…" : "Add note"}
            </Button>
            {create.error && (
              <span className="text-xs text-rose-700">{(create.error as Error).message}</span>
            )}
          </div>
        </div>
      </StackPanel>

      <StackPanel
        color={ACCENT}
        title={<span>Active ({active.length})</span>}
        right={
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="text-xs underline"
          >
            {showArchived ? "Hide archived" : `Show archived (${archived.length})`}
          </button>
        }
      >
        {active.length === 0 ? (
          <EmptyState icon={MessageSquare} message="No active notes. Add one above." />
        ) : (
          <ul className="flex flex-col gap-2 p-3">
            {active.map((n) => (
              <li
                key={n.id}
                className="flex items-start gap-3 rounded-md border bg-background p-3 text-sm"
              >
                <StackChip color="#27D17F">active</StackChip>
                <div className="flex-1 whitespace-pre-wrap">{n.body}</div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={archive.isPending}
                  onClick={() => archive.mutate(n.id)}
                >
                  Archive
                </Button>
              </li>
            ))}
          </ul>
        )}
      </StackPanel>

      {showArchived && archived.length > 0 && (
        <StackPanel color="#cbd5e1" title={<span>Archived ({archived.length})</span>}>
          <ul className="flex flex-col gap-2 p-3">
            {archived.map((n) => (
              <li
                key={n.id}
                className="flex items-start gap-3 rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground"
              >
                <StackChip color="#cbd5e1">archived</StackChip>
                <div className="flex-1 whitespace-pre-wrap">{n.body}</div>
              </li>
            ))}
          </ul>
        </StackPanel>
      )}
    </div>
  );
}
