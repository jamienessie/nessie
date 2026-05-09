import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, UserPlus } from "lucide-react";
import {
  hiresApi,
  HIRE_STATES,
  HIRE_NEXT_STATES,
  type Candidate,
  type Hire,
  type HireState,
  type RoleTemplate,
} from "../api/hires";
import { departmentsApi, type Department } from "../api/departments";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { PageSkeleton } from "../components/PageSkeleton";
import { Button } from "@/components/ui/button";

const NO_COMPANY = "__none__";

function statusTone(state: HireState): string {
  switch (state) {
    case "open": return "bg-muted text-muted-foreground";
    case "sourcing": return "bg-sky-500/15 text-sky-700 dark:text-sky-400";
    case "interviewing": return "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400";
    case "trial": return "bg-amber-500/15 text-amber-700 dark:text-amber-400";
    case "recommended": return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400";
    case "hired": return "bg-emerald-600/20 text-emerald-700 dark:text-emerald-300";
    case "rejected": return "bg-destructive/15 text-destructive";
    default: return "bg-muted";
  }
}

function StageBadge({ state }: { state: HireState }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-mono uppercase tracking-wider ${statusTone(state)}`}>
      {state}
    </span>
  );
}

function CreateHireForm({
  companyId,
  templates,
  departments,
  onCreated,
  onCancel,
}: {
  companyId: string;
  templates: RoleTemplate[];
  departments: Department[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tier, setTier] = useState<"T1" | "T2" | "T3" | "">("");
  const [templateKey, setTemplateKey] = useState("");
  const [departmentId, setDepartmentId] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      hiresApi.create(companyId, {
        title,
        description: description || null,
        requestedTier: (tier || null) as "T1" | "T2" | "T3" | null,
        requestedRoleTemplateKey: templateKey || null,
        requestedDepartmentId: departmentId || null,
      }),
    onSuccess: () => onCreated(),
  });

  return (
    <form
      className="space-y-3 border border-border bg-card p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (title.trim()) mutation.mutate();
      }}
    >
      <h3 className="text-sm font-semibold">New hire request</h3>

      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Title</span>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Senior Backend Engineer"
          className="w-full border border-border bg-background px-2 py-1.5 text-sm"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Description</span>
        <textarea
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className="w-full border border-border bg-background px-2 py-1.5 text-sm"
        />
      </label>

      <div className="grid grid-cols-3 gap-2">
        <label className="block space-y-1">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Tier</span>
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as typeof tier)}
            className="w-full border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            <option value="T1">T1</option>
            <option value="T2">T2</option>
            <option value="T3">T3</option>
          </select>
        </label>
        <label className="block space-y-1 col-span-2">
          <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Department</span>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="w-full border border-border bg-background px-2 py-1.5 text-sm"
          >
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Role template (optional)
        </span>
        <select
          value={templateKey}
          onChange={(e) => setTemplateKey(e.target.value)}
          className="w-full border border-border bg-background px-2 py-1.5 text-sm"
        >
          <option value="">—</option>
          {templates.map((t) => (
            <option key={t.key} value={t.key}>
              {t.title} ({t.key})
            </option>
          ))}
        </select>
      </label>

      {mutation.error && (
        <p className="text-xs text-destructive">
          {mutation.error instanceof Error ? mutation.error.message : "Failed to create hire"}
        </p>
      )}

      <div className="flex items-center gap-2 pt-1">
        <Button type="submit" size="sm" disabled={mutation.isPending || !title.trim()}>
          {mutation.isPending ? "Creating…" : "Create hire"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function CandidateRow({
  candidate,
  hire,
  companyId,
  departments,
  onMutated,
}: {
  candidate: Candidate;
  hire: Hire;
  companyId: string;
  departments: Department[];
  onMutated: () => void;
}) {
  const [showMint, setShowMint] = useState(false);
  const [mintTier, setMintTier] = useState<"T1" | "T2" | "T3">(hire.requestedTier ?? "T2");
  const [mintAdapter, setMintAdapter] = useState("openai_compatible");
  const [mintDeptId, setMintDeptId] = useState(hire.requestedDepartmentId ?? "");

  const mintMutation = useMutation({
    mutationFn: () =>
      hiresApi.hireCandidate(companyId, candidate.id, {
        hireId: hire.id,
        finalFirstName: candidate.humanFirstName,
        finalLastName: candidate.humanLastName,
        finalTitle: candidate.title,
        finalTier: mintTier,
        finalAdapterType: mintAdapter,
        finalDepartmentId: mintDeptId || null,
      }),
    onSuccess: () => {
      setShowMint(false);
      onMutated();
    },
  });

  const statusMutation = useMutation({
    mutationFn: (to: Candidate["status"]) => hiresApi.setCandidateStatus(candidate.id, to),
    onSuccess: () => onMutated(),
  });

  return (
    <div className="border border-border bg-background/50 p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">
            {candidate.humanFirstName} {candidate.humanLastName} · {candidate.title}
          </div>
          <div className="mt-0.5 text-muted-foreground">
            <span className="font-mono uppercase tracking-wider text-[10px]">{candidate.status}</span>
            {candidate.proposedAdapterType && (
              <> · adapter <code className="font-mono">{candidate.proposedAdapterType}</code></>
            )}
            {candidate.sourceTemplateKey && (
              <> · template <code className="font-mono">{candidate.sourceTemplateKey}</code></>
            )}
          </div>
          {candidate.summary && (
            <p className="mt-1 text-muted-foreground leading-5">{candidate.summary}</p>
          )}
        </div>
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        {candidate.status !== "rejected" && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => statusMutation.mutate("rejected")}
            disabled={statusMutation.isPending}
          >
            Reject
          </Button>
        )}
        {hire.status === "recommended" && candidate.status !== "rejected" && !showMint && (
          <Button size="sm" onClick={() => setShowMint(true)}>
            Mint as agent
          </Button>
        )}
      </div>

      {showMint && (
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3">
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Tier</span>
            <select
              value={mintTier}
              onChange={(e) => setMintTier(e.target.value as "T1" | "T2" | "T3")}
              className="w-full border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="T1">T1</option>
              <option value="T2">T2</option>
              <option value="T3">T3</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Adapter</span>
            <select
              value={mintAdapter}
              onChange={(e) => setMintAdapter(e.target.value)}
              className="w-full border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="claude_local">claude_local</option>
              <option value="codex_local">codex_local</option>
              <option value="openai_compatible">openai_compatible</option>
              <option value="openrouter_compatible">openrouter_compatible</option>
              <option value="http_webhook">http_webhook</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Dept</span>
            <select
              value={mintDeptId}
              onChange={(e) => setMintDeptId(e.target.value)}
              className="w-full border border-border bg-background px-2 py-1.5 text-xs"
            >
              <option value="">—</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </label>
          <div className="col-span-3 flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => mintMutation.mutate()}
              disabled={mintMutation.isPending}
            >
              {mintMutation.isPending ? "Minting…" : "Confirm mint"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setShowMint(false)}>
              Cancel
            </Button>
          </div>
          {mintMutation.error && (
            <p className="col-span-3 text-xs text-destructive">
              {mintMutation.error instanceof Error ? mintMutation.error.message : "Mint failed"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function AddCandidateForm({
  hire,
  templates,
  onCreated,
  onCancel,
}: {
  hire: Hire;
  templates: RoleTemplate[];
  onCreated: () => void;
  onCancel: () => void;
}) {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [title, setTitle] = useState(hire.title);
  const [summary, setSummary] = useState("");
  const [templateKey, setTemplateKey] = useState("");

  const mutation = useMutation({
    mutationFn: () =>
      hiresApi.addCandidate(hire.id, {
        humanFirstName: first,
        humanLastName: last,
        title,
        summary: summary || null,
        sourceTemplateKey: templateKey || null,
      }),
    onSuccess: () => onCreated(),
  });

  return (
    <form
      className="space-y-2 border border-dashed border-border p-3 text-xs"
      onSubmit={(e) => {
        e.preventDefault();
        if (first.trim() && last.trim() && title.trim()) mutation.mutate();
      }}
    >
      <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Add candidate
      </h4>
      <div className="grid grid-cols-2 gap-2">
        <input
          required
          placeholder="First name"
          value={first}
          onChange={(e) => setFirst(e.target.value)}
          className="border border-border bg-background px-2 py-1 text-xs"
        />
        <input
          required
          placeholder="Last name"
          value={last}
          onChange={(e) => setLast(e.target.value)}
          className="border border-border bg-background px-2 py-1 text-xs"
        />
      </div>
      <input
        required
        placeholder="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="w-full border border-border bg-background px-2 py-1 text-xs"
      />
      <textarea
        rows={2}
        placeholder="Summary (optional)"
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        className="w-full border border-border bg-background px-2 py-1 text-xs"
      />
      <select
        value={templateKey}
        onChange={(e) => setTemplateKey(e.target.value)}
        className="w-full border border-border bg-background px-2 py-1 text-xs"
      >
        <option value="">No template</option>
        {templates.map((t) => (
          <option key={t.key} value={t.key}>
            {t.title} ({t.key})
          </option>
        ))}
      </select>
      {mutation.error && (
        <p className="text-destructive">
          {mutation.error instanceof Error ? mutation.error.message : "Failed"}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button type="submit" size="sm" disabled={mutation.isPending}>
          {mutation.isPending ? "Adding…" : "Add"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function HireRow({
  hire,
  companyId,
  templates,
  departments,
  expanded,
  onToggle,
  onMutated,
}: {
  hire: Hire;
  companyId: string;
  templates: RoleTemplate[];
  departments: Department[];
  expanded: boolean;
  onToggle: () => void;
  onMutated: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const detail = useQuery({
    queryKey: ["hires", companyId, hire.id],
    queryFn: () => hiresApi.get(companyId, hire.id),
    enabled: expanded,
  });

  const transitionMutation = useMutation({
    mutationFn: (to: HireState) => hiresApi.transition(companyId, hire.id, to),
    onSuccess: () => {
      onMutated();
      detail.refetch();
    },
  });

  const next = HIRE_NEXT_STATES[hire.status] ?? [];

  return (
    <div className="border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent/40"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <StageBadge state={hire.status} />
        <span className="flex-1 truncate text-sm font-medium">{hire.title}</span>
        {hire.requestedTier && (
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {hire.requestedTier}
          </span>
        )}
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {new Date(hire.createdAt).toLocaleDateString()}
        </span>
      </button>

      {expanded && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          {hire.description && (
            <p className="text-xs leading-5 text-muted-foreground">{hire.description}</p>
          )}

          {next.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Advance →
              </span>
              {next.map((to) => (
                <Button
                  key={to}
                  size="sm"
                  variant={to === "rejected" ? "ghost" : "outline"}
                  onClick={() => transitionMutation.mutate(to)}
                  disabled={transitionMutation.isPending}
                >
                  {to}
                </Button>
              ))}
            </div>
          )}

          {transitionMutation.error && (
            <p className="text-xs text-destructive">
              {transitionMutation.error instanceof Error
                ? transitionMutation.error.message
                : "Transition failed"}
            </p>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Candidates {detail.data ? `(${detail.data.candidates.length})` : ""}
              </h4>
              {!adding && (
                <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                  Add candidate
                </Button>
              )}
            </div>

            {adding && (
              <AddCandidateForm
                hire={hire}
                templates={templates}
                onCreated={() => {
                  setAdding(false);
                  detail.refetch();
                }}
                onCancel={() => setAdding(false)}
              />
            )}

            {detail.isLoading && (
              <p className="text-xs text-muted-foreground italic">Loading candidates…</p>
            )}

            {detail.data?.candidates.length === 0 && !adding && (
              <p className="text-xs text-muted-foreground italic">No candidates yet.</p>
            )}

            {detail.data?.candidates.map((c) => (
              <CandidateRow
                key={c.id}
                candidate={c}
                hire={hire}
                companyId={companyId}
                departments={departments}
                onMutated={() => {
                  detail.refetch();
                  onMutated();
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function Hiring() {
  const { selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const companyId = selectedCompanyId ?? NO_COMPANY;
  const [filter, setFilter] = useState<HireState | "all">("all");
  const [creating, setCreating] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Hiring" }]);
  }, [setBreadcrumbs]);

  const { data: hireData, isLoading, error } = useQuery({
    queryKey: ["hires", companyId, filter],
    queryFn: () => hiresApi.list(companyId, filter === "all" ? undefined : filter),
    enabled: !!selectedCompanyId,
  });
  const { data: tplData } = useQuery({
    queryKey: ["role-templates"],
    queryFn: () => hiresApi.listRoleTemplates(),
  });
  const { data: deptData } = useQuery({
    queryKey: ["departments", companyId],
    queryFn: () => departmentsApi.list(companyId),
    enabled: !!selectedCompanyId,
  });

  const hires = useMemo(() => hireData?.hires ?? [], [hireData]);
  const counts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const h of hires) acc[h.status] = (acc[h.status] ?? 0) + 1;
    return acc;
  }, [hires]);

  if (!selectedCompanyId) {
    return <p className="text-sm text-muted-foreground">Select a company first.</p>;
  }
  if (isLoading) return <PageSkeleton variant="list" />;
  if (error) {
    return (
      <p className="text-sm text-destructive">
        {error instanceof Error ? error.message : String(error)}
      </p>
    );
  }

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["hires", companyId] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setFilter("all")}
            className={`border px-2 py-1 text-[11px] uppercase tracking-wider ${
              filter === "all"
                ? "border-foreground bg-foreground text-background"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            All ({hires.length})
          </button>
          {HIRE_STATES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFilter(s)}
              className={`border px-2 py-1 text-[11px] uppercase tracking-wider ${
                filter === s
                  ? "border-foreground bg-foreground text-background"
                  : "border-border text-muted-foreground hover:bg-accent"
              }`}
            >
              {s} {counts[s] ? `(${counts[s]})` : ""}
            </button>
          ))}
        </div>
        {!creating && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <UserPlus className="mr-1.5 h-3.5 w-3.5" />
            New hire
          </Button>
        )}
      </div>

      {creating && (
        <CreateHireForm
          companyId={companyId}
          templates={tplData?.templates ?? []}
          departments={deptData?.departments ?? []}
          onCreated={() => {
            setCreating(false);
            refresh();
          }}
          onCancel={() => setCreating(false)}
        />
      )}

      {hires.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          message="No hires yet. Open a hire request to start the 5-stage pipeline."
        />
      ) : (
        <div className="space-y-2">
          {hires.map((h) => (
            <HireRow
              key={h.id}
              hire={h}
              companyId={companyId}
              templates={tplData?.templates ?? []}
              departments={deptData?.departments ?? []}
              expanded={expandedId === h.id}
              onToggle={() => setExpandedId(expandedId === h.id ? null : h.id)}
              onMutated={refresh}
            />
          ))}
        </div>
      )}
    </div>
  );
}
