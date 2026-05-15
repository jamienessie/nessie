import { useEffect, useState } from "react";
import { useNavigate } from "@/lib/router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Wand2, Sparkles, ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { companyGeneratorApi, type ManifestPreview, type GenerationResult } from "../api/companyGenerator";
import { useCompany } from "../context/CompanyContext";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { queryKeys } from "../lib/queryKeys";
import { cn } from "../lib/utils";

const EXAMPLE_PROMPTS = [
  "I'm building a B2B SaaS for dentists. Target $20K MRR in 6 months. Solo founder, mostly indie distribution.",
  "Launching an indie-hacker tool that turns Zoom recordings into Loom-style highlight reels. Want 1,000 paying users by end of year.",
  "Starting an agency for AI integration consulting. Three founders. First goal is land two pilot clients in 60 days.",
];

export function CompanyGenerate() {
  const navigate = useNavigate();
  const { setSelectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();
  const queryClient = useQueryClient();
  const [prompt, setPrompt] = useState("");
  const [manifest, setManifest] = useState<ManifestPreview | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Generate a company" }]);
  }, [setBreadcrumbs]);

  const previewMutation = useMutation({
    mutationFn: () => companyGeneratorApi.preview(prompt.trim()),
    onSuccess: (m) => setManifest(m),
  });

  const generateMutation = useMutation({
    mutationFn: () => companyGeneratorApi.generate(prompt.trim()),
    onSuccess: (result: GenerationResult) => {
      // Refresh company list + select the new one + jump to its dashboard.
      void queryClient.invalidateQueries({ queryKey: queryKeys.companies.all });
      setSelectedCompanyId(result.companyId, { source: "route_sync" });
      navigate("/dashboard");
    },
  });

  const canSubmit = prompt.trim().length >= 10 && !generateMutation.isPending;

  return (
    <div className="max-w-3xl space-y-6">
      <div
        className="stack-card overflow-hidden relative"
        style={{
          background: "linear-gradient(135deg, #fffaf0 0%, #FFE0BB 60%, #FFC83A 100%)",
          color: "#0d0c10",
        }}
      >
        <div className="p-6 space-y-2">
          <div className="flex items-center gap-2 text-xs font-mono font-bold uppercase tracking-widest opacity-80">
            <Wand2 className="h-3 w-3" /> Company Generator
          </div>
          <h1 className="text-2xl font-extrabold">Boot a company in 60 seconds</h1>
          <p className="text-sm max-w-prose opacity-90">
            Describe what you're building in one paragraph. Nessie generates the company, founding
            team, goal, and starter issues — ready to run.
          </p>
        </div>
      </div>

      <div className="stack-card p-4 space-y-3">
        <label htmlFor="prompt" className="text-xs font-mono font-bold uppercase text-[#0d0c10]">
          One paragraph
        </label>
        <Textarea
          id="prompt"
          value={prompt}
          onChange={(e) => {
            setPrompt(e.target.value);
            setManifest(null);
          }}
          placeholder="I'm building..."
          rows={5}
          className="text-sm"
        />
        <div className="flex flex-wrap gap-2">
          {EXAMPLE_PROMPTS.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setPrompt(ex);
                setManifest(null);
              }}
              className="text-[11px] font-mono bg-[#FFF1B8] hover:bg-[#FFC83A] border-[1.5px] border-[#0d0c10] rounded-sm px-2 py-1 text-[#0d0c10]"
            >
              try this →
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[#5a525e]">
            We use a template for now. Swap with an LLM call later — same shape.
          </p>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => previewMutation.mutate()}
              disabled={prompt.trim().length < 10 || previewMutation.isPending}
            >
              {previewMutation.isPending ? "Previewing…" : "Preview manifest"}
            </Button>
            <Button
              size="sm"
              onClick={() => generateMutation.mutate()}
              disabled={!canSubmit}
              className="bg-[#0d0c10] text-white hover:bg-[#FF4D2E]"
            >
              {generateMutation.isPending ? (
                <span className="flex items-center gap-1.5">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Booting…
                </span>
              ) : (
                <span className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" /> Generate company <ArrowRight className="h-3.5 w-3.5" />
                </span>
              )}
            </Button>
          </div>
        </div>
        {generateMutation.isError && (
          <p className="text-xs text-destructive">
            Generation failed: {(generateMutation.error as Error)?.message ?? "unknown error"}
          </p>
        )}
      </div>

      {manifest && (
        <ManifestPreviewView manifest={manifest} />
      )}
    </div>
  );
}

function ManifestPreviewView({ manifest }: { manifest: ManifestPreview }) {
  return (
    <div className="space-y-4">
      {manifest.source === "template" && manifest.warning && (
        <div className="stack-card p-3 text-xs text-amber-800 bg-amber-100/60 border-amber-300">
          Showing template fallback. {manifest.warning}
        </div>
      )}
      {manifest.source === "llm" && (
        <div className="stack-card p-3 text-xs text-emerald-800 bg-emerald-100/60 border-emerald-300">
          ✦ Designed by Claude from your paragraph.
        </div>
      )}
      <div className="stack-card p-4 space-y-2">
        <div className="text-[10px] font-mono uppercase text-[#5a525e]">Company</div>
        <h2 className="text-xl font-extrabold">{manifest.companyName}</h2>
        <p className="text-sm text-[#3a3340]">{manifest.description}</p>
      </div>

      <div className="stack-card p-4 space-y-2">
        <div className="text-[10px] font-mono uppercase text-[#5a525e]">Top-level goal</div>
        <p className="text-base font-bold">{manifest.topLevelGoal.title}</p>
        <p className="text-sm text-[#3a3340]">{manifest.topLevelGoal.description}</p>
      </div>

      <div className="stack-card overflow-hidden">
        <div className="stack-panel-header" style={{ ["--stack-accent" as string]: "#A4D81F" }}>
          <span className="w-3 h-3 rounded-full bg-[#0d0c10]" />
          FOUNDING TEAM
          <span className="flex-1" />
          <span className="font-mono text-[10px] font-bold">{manifest.agents.length} agents</span>
        </div>
        <div className="divide-y-[1.5px] divide-[#0d0c10]">
          {manifest.agents.map((a) => (
            <div key={a.slug} className="px-4 py-3 flex items-start gap-3 text-sm">
              <span
                className={cn(
                  "inline-flex items-center justify-center rounded-sm px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-[#0d0c10] shrink-0",
                  a.tier === "T1" ? "bg-[#FF4D2E] text-white" : a.tier === "T2" ? "bg-[#FFC83A]" : "bg-[#C2EED8]",
                )}
              >
                {a.tier}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-[#0d0c10]">
                  {a.firstName} {a.lastName} <span className="text-[#5a525e] font-normal">· {a.title}</span>
                </p>
                <p className="text-xs text-[#5a525e]">{a.capabilities}</p>
                {a.reportsToSlug && (
                  <p className="text-[10px] font-mono uppercase text-[#5a525e] mt-1">
                    reports to → {a.reportsToSlug}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="stack-card overflow-hidden">
        <div className="stack-panel-header" style={{ ["--stack-accent" as string]: "#FFC83A" }}>
          <span className="w-3 h-3 rounded-full bg-[#0d0c10]" />
          STARTER ISSUES
          <span className="flex-1" />
          <span className="font-mono text-[10px] font-bold">{manifest.starterIssues.length} tasks</span>
        </div>
        <div className="divide-y-[1.5px] divide-[#0d0c10]">
          {manifest.starterIssues.map((i, idx) => (
            <div key={idx} className="px-4 py-3 text-sm">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "inline-flex items-center justify-center rounded-sm px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider",
                    i.priority === "critical"
                      ? "bg-[#FF4D2E] text-white"
                      : i.priority === "high"
                      ? "bg-[#FFC83A]"
                      : i.priority === "medium"
                      ? "bg-[#C8E5FF]"
                      : "bg-[#C2EED8]",
                  )}
                >
                  {i.priority}
                </span>
                <p className="font-semibold flex-1 truncate">{i.title}</p>
                <span className="text-[10px] font-mono uppercase text-[#5a525e] shrink-0">→ {i.assigneeSlug}</span>
              </div>
              <p className="text-xs text-[#5a525e] mt-1">{i.description}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
