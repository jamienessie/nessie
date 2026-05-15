import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Swords, ShieldCheck, Sparkles, RefreshCw, AlertTriangle } from "lucide-react";
import { approvalsApi, type ApprovalDebate } from "../api/approvals";
import { queryKeys } from "../lib/queryKeys";
import { Button } from "@/components/ui/button";
import { cn } from "../lib/utils";

interface ApprovalDebatePanelProps {
  approvalId: string;
  debate: ApprovalDebate | null;
  /** Whether the approval is in a state where a debate is still useful (pending/revision). */
  isOpen: boolean;
}

/**
 * Red Team / Blue Team panel for the Approval detail page.
 *
 * - If no debate has been generated, shows a single "Stage a debate" CTA.
 * - If a debate exists, renders two columns: red (against) on the left,
 *   blue (for) on the right, with a regenerate button.
 * - Once an approval is decided (approved/rejected), the panel stays visible
 *   so the reasoning trail survives the decision.
 */
export function ApprovalDebatePanel({ approvalId, debate, isOpen }: ApprovalDebatePanelProps) {
  const queryClient = useQueryClient();
  const [lastWarning, setLastWarning] = useState<string | null>(null);

  const generateMutation = useMutation({
    mutationFn: () => approvalsApi.generateDebate(approvalId),
    onSuccess: (result) => {
      setLastWarning(result.warning ?? null);
      queryClient.invalidateQueries({ queryKey: queryKeys.approvals.detail(approvalId) });
    },
  });

  if (!debate) {
    return (
      <div className="border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="rounded-md p-2 bg-muted/40">
            <Swords className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold">Red Team / Blue Team</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Surface the strongest argument <span className="font-semibold">against</span> and the
              strongest argument <span className="font-semibold">for</span> this approval before you
              sign. Built from the approval's own content.
            </p>
          </div>
          {isOpen && (
            <Button
              size="sm"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
              className="shrink-0"
            >
              {generateMutation.isPending ? "Staging…" : "Stage a debate"}
            </Button>
          )}
        </div>
        {generateMutation.isError && (
          <p className="text-xs text-destructive">
            Couldn't generate the debate. {(generateMutation.error as Error)?.message ?? ""}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/30 border-b border-border">
        <div className="flex items-center gap-2">
          <Swords className="h-4 w-4" />
          <h3 className="text-sm font-semibold">Red Team / Blue Team</h3>
          <span className="text-[10px] font-mono uppercase text-muted-foreground">
            {debate.generator === "template-v1" ? "template" : "agent"} · {new Date(debate.generatedAt).toLocaleTimeString()}
          </span>
        </div>
        <button
          type="button"
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Regenerate debate"
        >
          <RefreshCw className={cn("h-3 w-3", generateMutation.isPending && "animate-spin")} />
          {generateMutation.isPending ? "regenerating" : "regenerate"}
        </button>
      </div>

      <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
        {/* Red team — against */}
        <div className="p-4 space-y-3 bg-[#FFD1C4]/15">
          <div className="flex items-center gap-2">
            <span className="rounded-sm px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider bg-[#FF4D2E] text-white">
              Red Team
            </span>
            <span className="text-[11px] font-mono uppercase text-[#5a525e]">argument against</span>
          </div>
          <p className="text-sm font-semibold text-[#0d0c10]">{debate.redTeam.argument}</p>
          <ul className="text-xs space-y-1.5 text-[#3a3340]">
            {debate.redTeam.bullets.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-[#FF4D2E] font-bold shrink-0">·</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Blue team — for */}
        <div className="p-4 space-y-3 bg-[#C8E5FF]/20">
          <div className="flex items-center gap-2">
            <span className="rounded-sm px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider bg-[#1FA7FF] text-white">
              Blue Team
            </span>
            <span className="text-[11px] font-mono uppercase text-[#5a525e]">argument for</span>
          </div>
          <p className="text-sm font-semibold text-[#0d0c10]">{debate.blueTeam.argument}</p>
          <ul className="text-xs space-y-1.5 text-[#3a3340]">
            {debate.blueTeam.bullets.map((b, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-[#1FA7FF] font-bold shrink-0">·</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {lastWarning && (
        <div className="px-4 py-2 border-t border-amber-500/30 bg-amber-500/10 flex items-start gap-2 text-[11px] text-amber-800 dark:text-amber-200">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{lastWarning}</span>
        </div>
      )}
      <div className="px-4 py-2 border-t border-border bg-muted/20 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Sparkles className="h-3 w-3" />
        {debate.generator === "llm"
          ? "Generated by Claude via the cost-tier proxy."
          : "Generated from a template — add a credential in Settings to use a real model."}
        <ShieldCheck className="h-3 w-3 ml-auto opacity-60" />
      </div>
    </div>
  );
}
