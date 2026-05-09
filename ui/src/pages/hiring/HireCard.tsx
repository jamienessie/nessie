import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Link } from "@/lib/router";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Hire } from "@/api/hires";

interface HireCardProps {
  hire: Hire;
  /** Total candidate count for this hire — rendered as a small chip. */
  candidateCount: number;
  /** Optional className override (e.g., to constrain in DesignGuide). */
  className?: string;
}

function tierTone(tier: Hire["requestedTier"]): string {
  switch (tier) {
    case "T1": return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30";
    case "T2": return "bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30";
    case "T3": return "bg-muted text-muted-foreground border-border";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

/**
 * One card in the hiring kanban. The whole card is clickable — links
 * to /hiring/:hireId. Stage transitions happen on the detail page.
 */
export function HireCard({ hire, candidateCount, className }: HireCardProps) {
  return (
    <Link
      to={`/hiring/${hire.id}`}
      className={cn(
        "block no-underline text-inherit",
        "rounded-xl transition-shadow hover:shadow-sm",
        className,
      )}
    >
      <Card className="hover:bg-accent/30 transition-colors cursor-pointer py-3 gap-2">
        <CardContent className="px-4 py-0 space-y-2">
          <div className="flex items-start gap-2">
            <p className="flex-1 text-sm font-semibold leading-tight line-clamp-2">
              {hire.title}
            </p>
            {hire.requestedTier && (
              <span
                className={cn(
                  "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider",
                  tierTone(hire.requestedTier),
                )}
              >
                {hire.requestedTier}
              </span>
            )}
          </div>

          {hire.description && (
            <p className="text-xs text-muted-foreground line-clamp-2">{hire.description}</p>
          )}

          <div className="flex items-center justify-between pt-1">
            <Badge variant="ghost" className="text-[10px] gap-1 font-normal">
              <Users className="size-3" aria-hidden />
              {candidateCount} candidate{candidateCount === 1 ? "" : "s"}
            </Badge>
            <span className="text-[10px] text-muted-foreground/70 font-mono">
              {new Date(hire.createdAt).toLocaleDateString()}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
