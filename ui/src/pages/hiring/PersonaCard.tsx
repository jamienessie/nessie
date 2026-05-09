import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Identity } from "@/components/Identity";
import { StatusBadge } from "@/components/StatusBadge";
import type { Candidate } from "@/api/hires";

interface PersonaCardProps {
  candidate: Candidate;
  /** Optional className overrides — useful in DesignGuide to constrain width. */
  className?: string;
}

/**
 * Header card on the right pane of /hiring/:hireId — shows the
 * candidate's identity (avatar bubble in their accent colour from the
 * agent palette, name + title + status pill) plus the LLM-generated
 * summary and resume markdown.
 */
export function PersonaCard({ candidate, className }: PersonaCardProps) {
  const fullName = `${candidate.humanFirstName} ${candidate.humanLastName}`.trim();
  return (
    <Card className={className}>
      <CardContent className="px-6 py-0 space-y-3">
        <div className="flex items-start gap-3">
          <Identity name={fullName} agentId={candidate.id} size="lg" />
          <div className="flex-1 min-w-0" />
          <StatusBadge status={candidate.status} />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="font-medium">
            {candidate.title}
          </Badge>
          {candidate.proposedAdapterType && (
            <Badge variant="ghost" className="font-mono text-[10px] uppercase">
              {candidate.proposedAdapterType.replace(/_/g, " ")}
            </Badge>
          )}
        </div>

        {candidate.summary && (
          <p className="text-sm leading-relaxed">{candidate.summary}</p>
        )}

        {candidate.resumeMarkdown && (
          <div className="pt-3 border-t border-border space-y-1">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Resume
            </h4>
            <pre className="text-xs whitespace-pre-wrap font-sans text-foreground/90 leading-relaxed">
              {candidate.resumeMarkdown}
            </pre>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
