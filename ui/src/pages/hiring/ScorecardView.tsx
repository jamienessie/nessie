import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Scorecard } from "@/api/hires";

interface ScorecardViewProps {
  scorecard: Scorecard;
  className?: string;
}

const RECOMMENDATION_TONE: Record<string, string> = {
  strong_hire: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30",
  hire: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/20",
  weak_hire: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
  no_hire: "bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30",
  strong_no_hire: "bg-rose-500/25 text-rose-800 dark:text-rose-200 border-rose-500/40",
};

function recommendationLabel(rec: Scorecard["recommendation"]): string {
  if (!rec) return "no recommendation";
  return rec.replace(/_/g, " ");
}

/** Renders one scorecard row — pass label + recommendation + rubric bars + notes. */
export function ScorecardView({ scorecard, className }: ScorecardViewProps) {
  const recTone = scorecard.recommendation
    ? RECOMMENDATION_TONE[scorecard.recommendation] ?? "bg-muted text-muted-foreground"
    : "bg-muted text-muted-foreground";
  const totalScore = scorecard.rubric.reduce(
    (acc, r) => acc + (r.weight ?? 0) * (r.score ?? 0),
    0,
  );

  return (
    <Card className={className}>
      <CardContent className="px-6 py-0 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="font-mono uppercase text-[10px]">
              {scorecard.pass} pass
            </Badge>
            <span className="text-xs text-muted-foreground font-mono tabular-nums">
              {totalScore.toFixed(2)} / 5
            </span>
          </div>
          <span
            className={cn(
              "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium uppercase tracking-wide",
              recTone,
            )}
          >
            {recommendationLabel(scorecard.recommendation)}
          </span>
        </div>

        <div className="space-y-2">
          {scorecard.rubric.map((row, i) => {
            const widthPct = Math.max(0, Math.min(100, (row.score / 5) * 100));
            return (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium">{row.criterion}</span>
                  <span className="font-mono tabular-nums text-muted-foreground">
                    {row.score.toFixed(1)} · w{row.weight.toFixed(2)}
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full overflow-hidden bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      row.score >= 4
                        ? "bg-emerald-500"
                        : row.score >= 3
                          ? "bg-amber-500"
                          : "bg-rose-500",
                    )}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
                {row.note && (
                  <p className="text-[11px] text-muted-foreground pt-0.5">{row.note}</p>
                )}
              </div>
            );
          })}
        </div>

        {scorecard.notes && (
          <div className="pt-2 border-t border-border">
            <p className="text-xs leading-relaxed text-foreground/90">{scorecard.notes}</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
