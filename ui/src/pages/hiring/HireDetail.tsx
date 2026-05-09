import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronLeft,
  DoorOpen,
  Sparkles,
  X,
} from "lucide-react";
import {
  hiresApi,
  HIRE_NEXT_STATES,
  type Candidate,
  type HireState,
  type Scorecard,
} from "@/api/hires";
import { meetingsApi, type Meeting } from "@/api/meetings";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/StatusBadge";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { Link } from "@/lib/router";
import { CandidateCard } from "./CandidateCard";
import { PersonaCard } from "./PersonaCard";
import { ScorecardView } from "./ScorecardView";

export function HireDetail() {
  const { hireId = "" } = useParams<{ hireId: string }>();
  const navigate = useNavigate();
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const qc = useQueryClient();
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ["hire", selectedCompanyId, hireId],
    queryFn: () => hiresApi.get(selectedCompanyId!, hireId),
    enabled: !!selectedCompanyId && !!hireId,
    refetchInterval: 10_000,
  });

  const hire = detail.data?.hire;
  const candidates: Candidate[] = detail.data?.candidates ?? [];
  const selectedCandidate = useMemo(
    () => candidates.find((c) => c.id === selectedCandidateId) ?? candidates[0] ?? null,
    [candidates, selectedCandidateId],
  );

  // Scorecards for the selected candidate.
  const scorecardsQ = useQuery({
    queryKey: ["scorecards", selectedCandidate?.id],
    queryFn: () => hiresApi.listScorecards(selectedCandidate!.id),
    enabled: !!selectedCandidate,
  });
  const scorecards: Scorecard[] = scorecardsQ.data?.scorecards ?? [];

  // Latest meeting for the candidate (interview-mode meeting whose
  // metadata or title references this candidate). For v1 we just look
  // for meetings whose title contains the candidate's name — server
  // doesn't store hireId/candidateId on meetings yet.
  const meetingsQ = useQuery({
    queryKey: ["meetings", selectedCompanyId, "for-hire", hireId],
    queryFn: () => meetingsApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 15_000,
  });
  const candidateMeetings: Meeting[] = useMemo(() => {
    if (!selectedCandidate) return [];
    const all = meetingsQ.data?.meetings ?? [];
    const tag = `${selectedCandidate.humanFirstName} ${selectedCandidate.humanLastName}`;
    return all
      .filter((m) => m.mode === "interview" && m.title.includes(tag))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [meetingsQ.data?.meetings, selectedCandidate]);
  const latestMeeting = candidateMeetings[0];

  // Mutations
  const transition = useMutation({
    mutationFn: (to: HireState) => hiresApi.transition(selectedCompanyId!, hireId, to),
    onSuccess: () => {
      detail.refetch();
      qc.invalidateQueries({ queryKey: ["hires", selectedCompanyId] });
    },
  });

  const generateMore = useMutation({
    mutationFn: () => hiresApi.generateCandidates(selectedCompanyId!, hireId, 3),
    onSuccess: () => detail.refetch(),
  });

  const startInterview = useMutation({
    mutationFn: () =>
      hiresApi.startInterview(selectedCompanyId!, hireId, selectedCandidate!.id),
    onSuccess: ({ meetingId }) => {
      detail.refetch();
      meetingsQ.refetch();
      navigate(`/meetings/${meetingId}/room`);
    },
  });

  const synthesize = useMutation({
    mutationFn: (meetingId: string) =>
      hiresApi.synthesizeScorecard(selectedCompanyId!, hireId, selectedCandidate!.id, meetingId),
    onSuccess: () => scorecardsQ.refetch(),
  });

  const setCandidateStatus = useMutation({
    mutationFn: ({ candidateId, to }: { candidateId: string; to: Candidate["status"] }) =>
      hiresApi.setCandidateStatus(candidateId, to),
    onSuccess: () => detail.refetch(),
  });

  // Auto-select the first candidate when the list loads.
  useEffect(() => {
    if (!selectedCandidateId && candidates.length > 0) {
      setSelectedCandidateId(candidates[0].id);
    }
  }, [candidates, selectedCandidateId]);

  // Breadcrumbs.
  useEffect(() => {
    if (hire) {
      setBreadcrumbs([
        { label: "Hiring", href: "/hiring" },
        { label: hire.title },
      ]);
    } else {
      setBreadcrumbs([{ label: "Hiring", href: "/hiring" }, { label: "Loading…" }]);
    }
  }, [hire, setBreadcrumbs]);

  if (!selectedCompanyId) {
    return <EmptyState icon={Sparkles} message="Select a company first." />;
  }
  if (detail.isLoading) return <PageSkeleton variant="detail" />;
  if (detail.error || !hire) {
    return <EmptyState icon={Sparkles} message="Hire not found." />;
  }

  const allowedNext = HIRE_NEXT_STATES[hire.status] ?? [];
  const isTerminal = hire.status === "hired" || hire.status === "rejected";

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-0 overflow-hidden">
      {/* Left pane — hire header + candidate roster */}
      <div className="w-2/5 min-w-[320px] max-w-[480px] min-h-0 overflow-y-auto border-r border-border">
        <div className="p-5 space-y-4">
          <Link
            to="/hiring"
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3" /> Hiring board
          </Link>

          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <h1 className="flex-1 text-xl font-bold leading-tight">{hire.title}</h1>
              <StatusBadge status={hire.status} />
            </div>
            <div className="h-[2px] w-12 rounded-full" style={{ backgroundColor: "var(--tone-operator-fg)" }} />
            {hire.description && (
              <p className="text-sm text-muted-foreground leading-relaxed">{hire.description}</p>
            )}
          </div>

          {!isTerminal && (
            <div className="flex flex-wrap gap-1.5">
              {allowedNext.map((to) => (
                <Button
                  key={to}
                  size="sm"
                  variant={to === "rejected" ? "outline" : "default"}
                  onClick={() => transition.mutate(to)}
                  disabled={transition.isPending}
                  className={to === "rejected" ? "text-destructive" : ""}
                >
                  {to === "rejected" ? "Reject hire" : `Advance → ${to.replace(/_/g, " ")}`}
                </Button>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Candidates ({candidates.length})
              </h3>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => generateMore.mutate()}
                disabled={generateMore.isPending}
                className="h-7 text-xs"
              >
                <Sparkles className="size-3" />
                {generateMore.isPending ? "Generating…" : "Generate more"}
              </Button>
            </div>

            {candidates.length === 0 ? (
              <Card className="py-3">
                <CardContent className="px-4 py-0 text-center text-xs text-muted-foreground italic">
                  {hire.status === "open"
                    ? "Advance to Sourcing — Lena will generate candidate personas."
                    : "No candidates yet."}
                </CardContent>
              </Card>
            ) : (
              <Card className="py-0 overflow-hidden">
                <div className="divide-y divide-border">
                  {candidates.map((c) => (
                    <CandidateCard
                      key={c.id}
                      candidate={c}
                      scorecards={c.id === selectedCandidate?.id ? scorecards : []}
                      selected={c.id === selectedCandidate?.id}
                      onSelect={() => setSelectedCandidateId(c.id)}
                    />
                  ))}
                </div>
              </Card>
            )}
            {generateMore.error && (
              <p className="text-xs text-destructive">
                {generateMore.error instanceof Error
                  ? generateMore.error.message
                  : "Generation failed"}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Right pane — selected candidate detail */}
      <div className="flex-1 min-w-0 min-h-0 overflow-y-auto">
        {!selectedCandidate ? (
          <EmptyState
            icon={Sparkles}
            message={
              hire.status === "open"
                ? "Advance the hire to Sourcing to ask Lena for candidates."
                : "Pick a candidate to see their persona, interview, and scorecards."
            }
          />
        ) : (
          <div className="p-5 space-y-4">
            <PersonaCard candidate={selectedCandidate} />

            {/* Action bar */}
            <Card className="py-3">
              <CardContent className="px-4 py-0 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => startInterview.mutate()}
                  disabled={startInterview.isPending}
                >
                  <DoorOpen className="size-3" />
                  {startInterview.isPending ? "Starting…" : "Start interview"}
                </Button>
                {latestMeeting && (
                  <>
                    <Button asChild size="sm" variant="outline">
                      <Link to={`/meetings/${latestMeeting.id}/room`}>
                        <DoorOpen className="size-3" />
                        Open meeting room
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => synthesize.mutate(latestMeeting.id)}
                      disabled={synthesize.isPending}
                    >
                      <Sparkles className="size-3" />
                      {synthesize.isPending ? "Synthesising…" : "Synthesize scorecard"}
                    </Button>
                  </>
                )}
                <span className="ml-auto" />
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive hover:text-destructive"
                  onClick={() =>
                    setCandidateStatus.mutate({
                      candidateId: selectedCandidate.id,
                      to: "rejected",
                    })
                  }
                  disabled={setCandidateStatus.isPending}
                >
                  <X className="size-3" />
                  Reject candidate
                </Button>
              </CardContent>
            </Card>

            {/* Interviews list */}
            {candidateMeetings.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Interviews ({candidateMeetings.length})
                </h3>
                <Card className="py-0 overflow-hidden">
                  <div className="divide-y divide-border">
                    {candidateMeetings.map((m) => (
                      <Link
                        key={m.id}
                        to={`/meetings/${m.id}/room`}
                        className="flex items-center gap-3 px-4 py-2 hover:bg-accent/50 transition-colors no-underline text-inherit"
                      >
                        <StatusBadge status={m.state} />
                        <span className="flex-1 truncate text-sm">{m.title}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {new Date(m.createdAt).toLocaleString()}
                        </span>
                      </Link>
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {/* Scorecards */}
            {scorecards.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Scorecards ({scorecards.length})
                </h3>
                <div className="space-y-3">
                  {scorecards.map((s) => (
                    <ScorecardView key={s.id} scorecard={s} />
                  ))}
                </div>
              </div>
            )}

            {synthesize.error && (
              <p className="text-xs text-destructive">
                {synthesize.error instanceof Error
                  ? synthesize.error.message
                  : "Synthesis failed"}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
