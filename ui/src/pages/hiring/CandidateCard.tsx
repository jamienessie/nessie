import { Star } from "lucide-react";
import { EntityRow } from "@/components/EntityRow";
import { Identity } from "@/components/Identity";
import { StatusBadge } from "@/components/StatusBadge";
import type { Candidate, Scorecard } from "@/api/hires";

interface CandidateCardProps {
  candidate: Candidate;
  /** The candidate's scorecards (latest in [0]). Used to render a stars-helper trailing icon. */
  scorecards?: Scorecard[];
  selected?: boolean;
  onSelect?: () => void;
}

function topScore(scorecards: Scorecard[]): number | null {
  if (scorecards.length === 0) return null;
  const sorted = [...scorecards].sort((a, b) => {
    const totalA = a.rubric.reduce((acc, r) => acc + r.weight * r.score, 0);
    const totalB = b.rubric.reduce((acc, r) => acc + r.weight * r.score, 0);
    return totalB - totalA;
  });
  const top = sorted[0];
  const total = top.rubric.reduce((acc, r) => acc + r.weight * r.score, 0);
  return total;
}

/**
 * Single row in the candidate roster (left pane of /hiring/:hireId).
 * Uses EntityRow per design guide — leading slot is the candidate's
 * coloured avatar bubble (Identity), trailing has the status badge and
 * an optional stars helper.
 */
export function CandidateCard({ candidate, scorecards = [], selected, onSelect }: CandidateCardProps) {
  const fullName = `${candidate.humanFirstName} ${candidate.humanLastName}`.trim();
  const score = topScore(scorecards);

  return (
    <EntityRow
      leading={<Identity name={fullName} agentId={candidate.id} size="sm" />}
      title={candidate.title}
      subtitle={candidate.summary?.slice(0, 90) ?? undefined}
      trailing={
        <div className="flex items-center gap-2">
          {score !== null && (
            <span
              className="inline-flex items-center gap-0.5 text-xs font-mono tabular-nums text-muted-foreground"
              title={`${scorecards.length} scorecard${scorecards.length === 1 ? "" : "s"}`}
            >
              <Star className="size-3" aria-hidden />
              {score.toFixed(1)}
            </span>
          )}
          <StatusBadge status={candidate.status} />
        </div>
      }
      selected={selected}
      onClick={onSelect}
    />
  );
}
