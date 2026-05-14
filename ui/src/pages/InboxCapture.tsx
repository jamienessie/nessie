import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Inbox as InboxIcon } from "lucide-react";
import { inboxApi, type InboxItem, type InboxStatus } from "../api/inbox";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import { StackPanel, StackChip } from "@/components/stack";

const ACCENT = "#7C5CFF";

const STATUS_FILTERS: Array<{ label: string; value: InboxStatus | "all" }> = [
  { label: "Captured", value: "captured" },
  { label: "All", value: "all" },
  { label: "Dismissed", value: "dismissed" },
  { label: "Memory", value: "saved_as_memory" },
  { label: "Promoted", value: "became_issue" },
];

const TRIAGE_ACTIONS: Array<{ label: string; status: InboxStatus }> = [
  { label: "Dismiss", status: "dismissed" },
  { label: "Save as memory", status: "saved_as_memory" },
  { label: "Promote to issue", status: "became_issue" },
];

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function InboxCapture() {
  const { selectedCompanyId: companyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [filter, setFilter] = useState<InboxStatus | "all">("captured");

  useEffect(() => {
    setBreadcrumbs([{ label: "Capture" }]);
  }, [setBreadcrumbs]);

  const listQuery = useQuery({
    queryKey: ["inbox-capture", companyId, filter],
    queryFn: () => {
      if (!companyId) return Promise.resolve({ items: [] });
      return inboxApi.list(companyId, filter === "all" ? undefined : filter);
    },
    enabled: Boolean(companyId),
  });

  const captureMutation = useMutation({
    mutationFn: (input: { bodyMarkdown: string }) => {
      if (!companyId) throw new Error("companyId missing");
      return inboxApi.capture(companyId, { bodyMarkdown: input.bodyMarkdown, kind: "note" });
    },
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: ["inbox-capture", companyId] });
    },
  });

  const triageMutation = useMutation({
    mutationFn: (input: { itemId: string; status: InboxStatus }) => {
      if (!companyId) throw new Error("companyId missing");
      return inboxApi.triage(companyId, input.itemId, { status: input.status });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["inbox-capture", companyId] });
    },
  });

  const items: InboxItem[] = listQuery.data?.items ?? [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <StackPanel
        title={
          <span className="flex items-center gap-2">
            <InboxIcon className="h-4 w-4" />
            Capture — Phase 7 universal inbox
          </span>
        }
        color={ACCENT}
      >
        <form
          className="flex flex-col gap-2 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = body.trim();
            if (!trimmed) return;
            captureMutation.mutate({ bodyMarkdown: trimmed });
          }}
        >
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Quick note, url, idea…"
            className="min-h-[80px] resize-y rounded-md border bg-background px-3 py-2 text-sm font-mono"
            disabled={captureMutation.isPending}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
              {captureMutation.isError ? "capture failed — retry" : "press Capture to file"}
            </span>
            <Button type="submit" disabled={!body.trim() || captureMutation.isPending}>
              {captureMutation.isPending ? "Capturing…" : "Capture"}
            </Button>
          </div>
        </form>
      </StackPanel>

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_FILTERS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setFilter(opt.value)}
            className={`rounded-full border px-3 py-1 text-xs font-mono uppercase tracking-wider transition-colors ${
              filter === opt.value
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:border-foreground/40"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {listQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading inbox…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          message={filter === "captured"
            ? "Inbox is clear — nothing to triage. Capture a note above or change the filter to see history."
            : "No items match this filter."}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li key={item.id}>
              <StackPanel
                title={
                  <span className="flex items-center gap-2 text-xs">
                    <span className="font-mono uppercase tracking-wider">{item.kind}</span>
                    <span className="text-muted-foreground">· captured {formatRelative(item.createdAt)}</span>
                  </span>
                }
                color={ACCENT}
              >
                <div className="flex flex-col gap-2 p-3">
                  <p className="whitespace-pre-wrap text-sm font-mono">
                    {item.bodyMarkdown ?? "(no body)"}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <StackChip>{item.status}</StackChip>
                    {item.promotedKind && item.promotedId ? (
                      <StackChip>{item.promotedKind} → {item.promotedId.slice(0, 8)}</StackChip>
                    ) : null}
                    {item.status === "captured" ? (
                      <div className="ml-auto flex flex-wrap gap-1.5">
                        {TRIAGE_ACTIONS.map((action) => (
                          <Button
                            key={action.status}
                            size="sm"
                            variant="outline"
                            disabled={triageMutation.isPending}
                            onClick={() =>
                              triageMutation.mutate({ itemId: item.id, status: action.status })
                            }
                          >
                            {action.label}
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </StackPanel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
