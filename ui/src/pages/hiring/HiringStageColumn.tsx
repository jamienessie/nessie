import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { HireState } from "@/api/hires";

interface HiringStageColumnProps {
  state: HireState;
  count: number;
  children: ReactNode;
  className?: string;
}

const STAGE_LABEL: Record<HireState, string> = {
  open: "Open",
  sourcing: "Sourcing",
  interviewing: "Interviewing",
  trial: "Trial",
  recommended: "Recommended",
  hired: "Hired",
  rejected: "Rejected",
};

const STAGE_TONE: Record<HireState, string> = {
  open: "text-muted-foreground",
  sourcing: "text-sky-600 dark:text-sky-400",
  interviewing: "text-indigo-600 dark:text-indigo-400",
  trial: "text-amber-600 dark:text-amber-400",
  recommended: "text-emerald-600 dark:text-emerald-400",
  hired: "text-emerald-700 dark:text-emerald-300",
  rejected: "text-rose-600 dark:text-rose-400",
};

/** A column in the hiring kanban — header label + count + scrollable cards stack. */
export function HiringStageColumn({ state, count, children, className }: HiringStageColumnProps) {
  return (
    <div
      className={cn(
        "flex flex-col min-h-0 border border-border rounded-lg bg-muted/20",
        className,
      )}
    >
      <header className="shrink-0 px-3 py-2 border-b border-border flex items-center justify-between">
        <span className={cn("text-xs font-semibold uppercase tracking-wide", STAGE_TONE[state])}>
          {STAGE_LABEL[state]}
        </span>
        <span className="text-[10px] tabular-nums font-mono text-muted-foreground">
          {count}
        </span>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
        {children}
      </div>
    </div>
  );
}
