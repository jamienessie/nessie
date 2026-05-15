import { useEffect } from "react";
import { useNavigate } from "@/lib/router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Store, Sparkles, Users, Briefcase, ListChecks, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { clipmartApi, type ClipMartEntry } from "../api/clipmart";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";

/**
 * ClipMart — public catalogue of company templates ready to fork into the
 * operator's instance. MVP backs onto an in-process catalog and forks via
 * the Company Generator. Replace the catalog source with a real registry
 * fetch later; the UI shape stays the same.
 */
export function ClipMart() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const { setSelectedCompanyId } = useCompany();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    setBreadcrumbs([{ label: "ClipMart" }]);
  }, [setBreadcrumbs]);

  const { data, isLoading } = useQuery({
    queryKey: ["clipmart", "catalog"],
    queryFn: () => clipmartApi.list(),
  });

  const forkMutation = useMutation({
    mutationFn: (slug: string) => clipmartApi.fork(slug),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      setSelectedCompanyId(result.companyId, { source: "route_sync" });
      navigate("/dashboard");
    },
  });

  return (
    <div className="space-y-6">
      <div
        className="stack-card overflow-hidden relative"
        style={{
          background: "linear-gradient(135deg, #fffaf0 0%, #C8E5FF 60%, #1FA7FF 100%)",
          color: "#0d0c10",
        }}
      >
        <div className="p-6 space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest opacity-80">
            <Store className="h-3 w-3" /> ClipMart
          </div>
          <h1 className="text-2xl font-extrabold">Fork a company in one click</h1>
          <p className="text-sm max-w-prose opacity-90">
            Reusable company templates — orgs, founding teams, starter issues — packaged so you can
            stand a new company up in seconds. Pick one. Fork it. Make it yours.
          </p>
        </div>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading catalogue…</p>}

      <div className="grid md:grid-cols-2 gap-4">
        {(data?.entries ?? []).map((entry) => (
          <EntryCard
            key={entry.slug}
            entry={entry}
            isForking={forkMutation.isPending && forkMutation.variables === entry.slug}
            onFork={() => forkMutation.mutate(entry.slug)}
          />
        ))}
      </div>

      {forkMutation.isError && (
        <p className="text-xs text-destructive">
          Fork failed: {(forkMutation.error as Error)?.message ?? "unknown error"}
        </p>
      )}
    </div>
  );
}

interface EntryCardProps {
  entry: ClipMartEntry;
  isForking: boolean;
  onFork: () => void;
}

function EntryCard({ entry, isForking, onFork }: EntryCardProps) {
  return (
    <div className="stack-card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-extrabold text-[#0d0c10]">{entry.name}</h2>
          <p className="text-[10px] font-mono uppercase text-[#5a525e] mt-0.5">{entry.authorHandle}</p>
        </div>
        <Sparkles className="h-4 w-4 text-[#5a525e] shrink-0" aria-hidden />
      </div>

      <p className="text-sm text-[#3a3340] flex-1">{entry.tagline}</p>

      <div className="flex flex-wrap gap-1.5">
        {entry.tags.map((t) => (
          <span
            key={t}
            className="bg-[#FFF1B8] border-[1.5px] border-[#0d0c10] rounded-sm px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase text-[#0d0c10]"
          >
            {t}
          </span>
        ))}
      </div>

      <div className="flex items-center gap-3 text-[10px] font-mono uppercase text-[#5a525e]">
        <span className="flex items-center gap-1"><Users className="h-3 w-3" /> {entry.stats.agents} agents</span>
        <span className="flex items-center gap-1"><Briefcase className="h-3 w-3" /> {entry.stats.departments} depts</span>
        <span className="flex items-center gap-1"><ListChecks className="h-3 w-3" /> {entry.stats.issues} issues</span>
      </div>

      <Button
        size="sm"
        onClick={onFork}
        disabled={isForking}
        className="bg-[#0d0c10] text-white hover:bg-[#FF4D2E]"
      >
        {isForking ? (
          <span className="flex items-center gap-1.5">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Forking…
          </span>
        ) : (
          <span>Fork into my instance</span>
        )}
      </Button>
    </div>
  );
}
