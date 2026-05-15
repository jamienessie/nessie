import { useMemo } from "react";
import { Link } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Moon, Sparkles, X, ChevronRight } from "lucide-react";
import { dreamsApi, type Dream } from "../api/dreams";
import { queryKeys } from "../lib/queryKeys";
import { timeAgo } from "../lib/timeAgo";
import { cn } from "../lib/utils";

interface DreamsWidgetProps {
  companyId: string;
  /** How many to show inline. The Dream Journal page shows all. */
  limit?: number;
}

/**
 * Sleep Mode surface for the dashboard. Renders the most recent "dreams" —
 * inbox_items with kind=dream captured by agents (or seeded by the user).
 *
 * If there are no dreams yet, shows a small whimsical empty state explaining
 * the feature rather than just a blank card.
 */
export function DreamsWidget({ companyId, limit = 5 }: DreamsWidgetProps) {
  const queryClient = useQueryClient();

  const { data: dreams } = useQuery({
    queryKey: queryKeys.dreams(companyId),
    queryFn: () => dreamsApi.list(companyId, { limit }),
    enabled: !!companyId,
  });

  const dismissMutation = useMutation({
    mutationFn: (dreamId: string) => dreamsApi.dismiss(companyId, dreamId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.dreams(companyId) }),
  });

  const visibleDreams = useMemo(
    () => (dreams ?? []).filter((d) => d.status === "captured").slice(0, limit),
    [dreams, limit],
  );

  return (
    <div className="stack-card flex flex-col overflow-hidden">
      <div className="stack-panel-header" style={{ ["--stack-accent" as string]: "#FFD2EA" }}>
        <Moon className="h-3 w-3 text-[#0d0c10]" aria-hidden />
        LAST NIGHT'S DREAMS
        <span className="flex-1" />
        <Link
          to="/dreams"
          className="font-mono text-[10px] font-bold no-underline text-[#0d0c10] hover:underline flex items-center gap-0.5"
        >
          journal
          <ChevronRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>

      {visibleDreams.length === 0 ? (
        <div className="p-6 text-center space-y-1">
          <Sparkles className="mx-auto h-6 w-6 text-[#5a525e]" aria-hidden />
          <p className="text-sm font-semibold text-[#0d0c10]">No dreams yet</p>
          <p className="text-xs text-[#5a525e]">
            When the company is idle, agents will riff on the goal here.
          </p>
        </div>
      ) : (
        <div className="divide-y-[1.5px] divide-[#0d0c10]">
          {visibleDreams.map((dream) => (
            <DreamRow
              key={dream.id}
              dream={dream}
              onDismiss={() => dismissMutation.mutate(dream.id)}
              isDismissing={dismissMutation.isPending && dismissMutation.variables === dream.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface DreamRowProps {
  dream: Dream;
  onDismiss: () => void;
  isDismissing: boolean;
}

function DreamRow({ dream, onDismiss, isDismissing }: DreamRowProps) {
  const body = dream.bodyMarkdown ?? "(no content)";
  // Strip simple markdown for the inline preview — proper rendering happens on
  // the Dream Journal page.
  const preview = body.replace(/[#*_`>]/g, "").trim();

  return (
    <div className="px-4 py-3 text-sm flex items-start gap-3">
      <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#5a525e]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="line-clamp-3 text-[#0d0c10]">{preview}</p>
        <p className="mt-1 flex items-center gap-2 text-[10px] font-mono font-bold uppercase text-[#5a525e]">
          <span>{timeAgo(dream.createdAt)}</span>
          {dream.capturedByAgentId && <span>· dreamer attached</span>}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        disabled={isDismissing}
        className={cn(
          "p-1 rounded text-[#5a525e] hover:bg-[#FFF1B8] hover:text-[#0d0c10] transition-colors",
          isDismissing && "opacity-50",
        )}
        aria-label="Dismiss dream"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
