import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@/lib/router";
import { cn } from "@/lib/utils";

export type MetricCardTone = "neutral" | "success" | "warning" | "info" | "spend";

interface MetricCardProps {
  icon: LucideIcon;
  value: string | number;
  label: string;
  description?: ReactNode;
  to?: string;
  onClick?: () => void;
  tone?: MetricCardTone;
}

const toneValueClass: Record<MetricCardTone, string> = {
  neutral: "",
  success: "text-emerald-700 dark:text-emerald-300",
  warning: "text-amber-700 dark:text-amber-300",
  info: "text-sky-700 dark:text-sky-300",
  spend: "text-cyan-700 dark:text-cyan-300",
};

const toneIconClass: Record<MetricCardTone, string> = {
  neutral: "text-muted-foreground/50",
  success: "text-emerald-500 dark:text-emerald-400",
  warning: "text-amber-500 dark:text-amber-400",
  info: "text-sky-500 dark:text-sky-400",
  spend: "text-cyan-500 dark:text-cyan-400",
};

const toneStripClass: Record<MetricCardTone, string> = {
  neutral: "",
  success: "before:bg-gradient-to-r before:from-emerald-500/40 before:to-transparent",
  warning: "before:bg-gradient-to-r before:from-amber-500/40 before:to-transparent",
  info: "before:bg-gradient-to-r before:from-sky-500/40 before:to-transparent",
  spend: "before:bg-gradient-to-r before:from-cyan-500/40 before:to-transparent",
};

export function MetricCard({ icon: Icon, value, label, description, to, onClick, tone = "neutral" }: MetricCardProps) {
  const isClickable = !!(to || onClick);

  const inner = (
    <div
      className={cn(
        "relative h-full px-4 py-4 sm:px-5 sm:py-5 rounded-lg transition-colors",
        // Top accent strip for non-neutral tones
        tone !== "neutral" && cn(
          "before:absolute before:top-0 before:left-0 before:right-0 before:h-0.5 before:rounded-t-lg",
          toneStripClass[tone],
        ),
        isClickable && "hover:bg-accent/50 cursor-pointer",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className={cn(
            "text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums",
            toneValueClass[tone],
          )}>
            {value}
          </p>
          <p className="text-xs sm:text-sm font-medium text-muted-foreground mt-1">
            {label}
          </p>
          {description && (
            <div className="text-xs text-muted-foreground/70 mt-1.5 hidden sm:block">{description}</div>
          )}
        </div>
        <Icon className={cn("h-4 w-4 shrink-0 mt-1.5", toneIconClass[tone])} />
      </div>
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="no-underline text-inherit h-full" onClick={onClick}>
        {inner}
      </Link>
    );
  }

  if (onClick) {
    return (
      <div className="h-full" onClick={onClick}>
        {inner}
      </div>
    );
  }

  return inner;
}
