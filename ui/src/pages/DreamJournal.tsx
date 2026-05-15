import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Moon, Sparkles, X, Plus, Wand2 } from "lucide-react";
import { dreamsApi, type Dream } from "../api/dreams";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { timeAgo } from "../lib/timeAgo";
import { cn } from "../lib/utils";
import { EmptyState } from "../components/EmptyState";

/**
 * Dream Journal — the full feed of every dream captured for this company.
 *
 * Visual style leans whimsical (starfield gradient, sleepy typography) to set
 * Sleep Mode apart from the rest of the cockpit. It's deliberately the most
 * "fun" surface in the app.
 */
export function DreamJournal() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<"active" | "all" | "dismissed">("active");
  const [composeOpen, setComposeOpen] = useState(false);
  const [lastWarning, setLastWarning] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Dream Journal" }]);
  }, [setBreadcrumbs]);

  const { data: dreams, isLoading } = useQuery({
    queryKey: queryKeys.dreams(selectedCompanyId!),
    queryFn: () => dreamsApi.list(selectedCompanyId!, { limit: 100 }),
    enabled: !!selectedCompanyId,
  });

  const dismissMutation = useMutation({
    mutationFn: (dreamId: string) =>
      dreamsApi.dismiss(selectedCompanyId!, dreamId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.dreams(selectedCompanyId!) }),
  });

  const generateMutation = useMutation({
    mutationFn: () => dreamsApi.generate(selectedCompanyId!),
    onSuccess: (result) => {
      setLastWarning(result.source === "template" ? result.warning ?? null : null);
      queryClient.invalidateQueries({ queryKey: queryKeys.dreams(selectedCompanyId!) });
    },
  });

  const filtered = useMemo(() => {
    if (!dreams) return [];
    if (filter === "active") return dreams.filter((d) => d.status === "captured");
    if (filter === "dismissed") return dreams.filter((d) => d.status === "dismissed");
    return dreams;
  }, [dreams, filter]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Moon} message="Select a company to view its dreams." />;
  }

  return (
    <div className="space-y-6">
      {/* Header — gradient starfield-style banner */}
      <div
        className="stack-card overflow-hidden relative"
        style={{
          background:
            "linear-gradient(135deg, #2a1f3d 0%, #4b3a5c 50%, #1a1525 100%)",
          color: "#ECE7F2",
        }}
      >
        <div className="p-6 relative z-10">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1 text-xs font-mono font-bold uppercase tracking-widest opacity-80">
                <Moon className="h-3 w-3" /> Sleep Mode
              </div>
              <h1 className="text-2xl font-extrabold">Dream Journal</h1>
              <p className="mt-1 text-sm opacity-80 max-w-prose">
                When the company has no urgent work, agents riff on the goal.
                The best dreams become real initiatives.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                className="flex items-center gap-1 rounded-md bg-white/20 hover:bg-white/35 px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-50"
              >
                <Wand2 className="h-4 w-4" /> {generateMutation.isPending ? "Dreaming…" : "Dream now"}
              </button>
              <button
                type="button"
                onClick={() => setComposeOpen(true)}
                className="flex items-center gap-1 rounded-md bg-white/15 hover:bg-white/25 px-3 py-2 text-sm font-semibold transition-colors"
              >
                <Plus className="h-4 w-4" /> Capture a dream
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 text-xs font-mono font-bold uppercase">
        {(["active", "all", "dismissed"] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={cn(
              "px-3 py-1.5 rounded-md border-[1.5px] border-[#0d0c10] transition-colors",
              filter === f ? "bg-[#0d0c10] text-white" : "bg-white text-[#0d0c10] hover:bg-[#FFF1B8]",
            )}
          >
            {f}
          </button>
        ))}
        <span className="ml-auto self-center text-[10px] text-[#5a525e]">
          {filtered.length} {filtered.length === 1 ? "dream" : "dreams"}
        </span>
      </div>

      {composeOpen && (
        <DreamComposer
          companyId={selectedCompanyId}
          onClose={() => setComposeOpen(false)}
          onCaptured={() =>
            queryClient.invalidateQueries({ queryKey: queryKeys.dreams(selectedCompanyId) })
          }
        />
      )}

      {lastWarning && (
        <div className="stack-card p-3 text-xs text-amber-800 bg-amber-100/60 border-amber-300">
          Falling back to a template dream. {lastWarning}
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-[#5a525e]">Loading dreams…</p>
      ) : filtered.length === 0 ? (
        <div className="stack-card p-10 text-center space-y-2">
          <Sparkles className="mx-auto h-8 w-8 text-[#5a525e]" aria-hidden />
          <p className="text-base font-semibold text-[#0d0c10]">No dreams in this view</p>
          <p className="text-sm text-[#5a525e]">
            Idle agents will start dreaming as soon as sleep mode triggers.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((dream) => (
            <DreamCard
              key={dream.id}
              dream={dream}
              onDismiss={() => dismissMutation.mutate(dream.id)}
              isDismissing={
                dismissMutation.isPending && dismissMutation.variables === dream.id
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DreamCardProps {
  dream: Dream;
  onDismiss: () => void;
  isDismissing: boolean;
}

function DreamCard({ dream, onDismiss, isDismissing }: DreamCardProps) {
  const dismissed = dream.status === "dismissed";

  return (
    <div className={cn("stack-card p-4 space-y-2", dismissed && "opacity-60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap text-sm text-[#0d0c10]">
            {dream.bodyMarkdown ?? "(no content)"}
          </p>
        </div>
        {!dismissed && (
          <button
            type="button"
            onClick={onDismiss}
            disabled={isDismissing}
            className={cn(
              "p-1.5 rounded text-[#5a525e] hover:bg-[#FFF1B8] hover:text-[#0d0c10] transition-colors shrink-0",
              isDismissing && "opacity-50",
            )}
            aria-label="Dismiss dream"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex items-center gap-3 text-[10px] font-mono font-bold uppercase text-[#5a525e]">
        <span>{timeAgo(dream.createdAt)}</span>
        {dream.capturedByAgentId && <span>· dreamer attached</span>}
        {dream.status !== "captured" && <span>· {dream.status.replace(/_/g, " ")}</span>}
      </div>
    </div>
  );
}

interface DreamComposerProps {
  companyId: string;
  onClose: () => void;
  onCaptured: () => void;
}

function DreamComposer({ companyId, onClose, onCaptured }: DreamComposerProps) {
  const [body, setBody] = useState("");
  const mutation = useMutation({
    mutationFn: () => dreamsApi.capture(companyId, { bodyMarkdown: body.trim() }),
    onSuccess: () => {
      onCaptured();
      setBody("");
      onClose();
    },
  });

  return (
    <div className="stack-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-extrabold uppercase text-[#0d0c10]">
          Capture a dream
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded hover:bg-[#FFF1B8] text-[#5a525e]"
          aria-label="Close composer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="What did the company dream about?"
        rows={4}
        className="w-full rounded-md border-[1.5px] border-[#0d0c10] p-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#FFC83A]"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-sm font-semibold rounded-md border-[1.5px] border-[#0d0c10] bg-white hover:bg-[#FFF1B8]"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => mutation.mutate()}
          disabled={body.trim().length === 0 || mutation.isPending}
          className={cn(
            "px-3 py-1.5 text-sm font-extrabold rounded-md border-[1.5px] border-[#0d0c10] bg-[#0d0c10] text-white",
            (body.trim().length === 0 || mutation.isPending) && "opacity-50",
          )}
        >
          {mutation.isPending ? "Saving…" : "Save dream"}
        </button>
      </div>
      {mutation.isError && (
        <p className="text-xs text-destructive">Failed to save dream. Try again.</p>
      )}
    </div>
  );
}
