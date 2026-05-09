import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, UserPlus } from "lucide-react";
import { hiresApi, HIRE_STATES, type Hire, type HireState } from "@/api/hires";
import { useCompany } from "@/context/CompanyContext";
import { useBreadcrumbs } from "@/context/BreadcrumbContext";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { PageSkeleton } from "@/components/PageSkeleton";
import { HiringStageColumn } from "./HiringStageColumn";
import { HireCard } from "./HireCard";
import { NewHireDialog } from "./NewHireDialog";

const ACTIVE_STAGES: HireState[] = ["open", "sourcing", "interviewing", "trial", "recommended"];
const CLOSED_STAGES: HireState[] = ["hired", "rejected"];

export function HiringBoard() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const [showClosed, setShowClosed] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    setBreadcrumbs([{ label: "Hiring" }]);
  }, [setBreadcrumbs]);

  const hiresQ = useQuery({
    queryKey: ["hires", selectedCompanyId],
    queryFn: () => hiresApi.list(selectedCompanyId!),
    enabled: !!selectedCompanyId,
    refetchInterval: 15_000,
  });

  // Per-hire candidate counts. Cheap: one /hires/:id GET per hire on
  // mount + invalidation. For v1 this is fine; if it grows, the server
  // can return counts on /hires.
  const hires: Hire[] = useMemo(() => hiresQ.data?.hires ?? [], [hiresQ.data]);
  const visibleHires = useMemo(
    () => hires.filter((h) => showClosed || ACTIVE_STAGES.includes(h.status as HireState)),
    [hires, showClosed],
  );
  const byStage = useMemo(() => {
    const m = new Map<HireState, Hire[]>();
    for (const stage of HIRE_STATES) m.set(stage, []);
    for (const hire of visibleHires) {
      const arr = m.get(hire.status as HireState);
      if (arr) arr.push(hire);
    }
    return m;
  }, [visibleHires]);

  // Bulk-fetch candidate counts. We intentionally skip individual GETs
  // and read from the existing `/hires/:id` endpoint as the user opens
  // each hire — for the kanban itself, candidate counts come from
  // simply showing 0 unless an aggregate field is added later. For v1
  // we display "—" until the user opens a hire.
  const candidateCounts = new Map<string, number>();

  if (!selectedCompanyId) {
    return <EmptyState icon={UserPlus} message="Select a company first." />;
  }
  if (hiresQ.isLoading) return <PageSkeleton variant="list" />;

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-0 flex-col">
      {/* Header */}
      <header className="shrink-0 px-5 py-4 border-b border-border space-y-2">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-bold">Hiring</h1>
            <div className="h-[2px] w-12 rounded-full mt-1" style={{ backgroundColor: "var(--tone-operator-fg)" }} />
            <p className="text-sm text-muted-foreground mt-1">
              Lena Park sources candidates and runs interviews. You approve at every stage gate.
            </p>
          </div>
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus className="size-3" />
            New hire
          </Button>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <Button
            size="sm"
            variant={showClosed ? "secondary" : "ghost"}
            onClick={() => setShowClosed((v) => !v)}
            className="h-7 text-xs"
          >
            {showClosed ? "Hide closed" : "Show closed"}
          </Button>
          <span className="text-[10px] text-muted-foreground font-mono">
            {visibleHires.length} hire{visibleHires.length === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      {/* Kanban */}
      <div className="flex-1 min-h-0 overflow-x-auto p-3">
        <div
          className={`grid gap-3 h-full min-w-[1100px] ${showClosed ? "grid-cols-7" : "grid-cols-5"}`}
        >
          {ACTIVE_STAGES.map((stage) => {
            const cards = byStage.get(stage) ?? [];
            return (
              <HiringStageColumn key={stage} state={stage} count={cards.length}>
                {cards.map((hire) => (
                  <HireCard
                    key={hire.id}
                    hire={hire}
                    candidateCount={candidateCounts.get(hire.id) ?? 0}
                  />
                ))}
                {cards.length === 0 && (
                  <p className="text-[11px] text-muted-foreground italic px-1 py-2">
                    {stage === "open" ? "No open hires." : "Empty."}
                  </p>
                )}
              </HiringStageColumn>
            );
          })}
          {showClosed
            && CLOSED_STAGES.map((stage) => {
              const cards = byStage.get(stage) ?? [];
              return (
                <HiringStageColumn key={stage} state={stage} count={cards.length}>
                  {cards.map((hire) => (
                    <HireCard
                      key={hire.id}
                      hire={hire}
                      candidateCount={candidateCounts.get(hire.id) ?? 0}
                    />
                  ))}
                  {cards.length === 0 && (
                    <p className="text-[11px] text-muted-foreground italic px-1 py-2">Empty.</p>
                  )}
                </HiringStageColumn>
              );
            })}
        </div>
      </div>

      <NewHireDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        companyId={selectedCompanyId}
      />
    </div>
  );
}
