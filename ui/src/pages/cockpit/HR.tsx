import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import { Topbar, Pulse, AgentLabel, Panel, StarBar, AvatarCircle, HireDialog } from "@/components/cockpit";

// 5-stage kanban: Open → Sourcing → Interviewing → Trial → Recommended
// + an unobtrusive Hired/Rejected lane summary at the bottom.

type RoleTemplate = {
  key: string;
  defaultFirstName: string;
  defaultLastName: string;
  title: string;
  tier: "T1" | "T2" | "T3";
  departmentKey: string;
  defaultAdapterType?: string;
  pitch: string;
};

type Hire = {
  id: string;
  status: string;
  title: string;
  description: string | null;
  requestedTier: string;
  requestedRoleTemplateKey: string | null;
};

const STAGES: ReadonlyArray<{ key: string; label: string; accent: string }> = [
  { key: "open", label: "Open", accent: "var(--gold)" },
  { key: "sourcing", label: "Sourcing", accent: "var(--d-prod)" },
  { key: "interviewing", label: "Interviewing", accent: "var(--d-eng)" },
  { key: "trial", label: "Trial", accent: "var(--t3)" },
  { key: "recommended", label: "Recommended", accent: "var(--t1)" },
];

export function CockpitHR() {
  const { selectedCompany } = useCompany();
  const [hires, setHires] = useState<Hire[]>([]);
  const [templates, setTemplates] = useState<RoleTemplate[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Phase 10B.1 — Hire dialog state.
  const [hireTemplate, setHireTemplate] = useState<RoleTemplate | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const reloadHires = async () => {
    if (!selectedCompany?.id) return;
    try {
      const res = await api.get<{ hires: Hire[] }>(`/hires?companyId=${encodeURIComponent(selectedCompany.id)}`);
      setHires(res.hires ?? []);
    } catch { /* swallow */ }
  };

  useEffect(() => {
    if (!selectedCompany?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [hiresRes, tmplRes] = await Promise.all([
          api.get<{ hires: Hire[] }>(`/hires?companyId=${encodeURIComponent(selectedCompany.id)}`),
          api.get<{ templates: RoleTemplate[] }>(`/role-templates`),
        ]);
        if (cancelled) return;
        setHires(hiresRes.hires ?? []);
        setTemplates(tmplRes.templates ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCompany?.id]);

  const byStage = useMemo(() => {
    const map: Record<string, Hire[]> = { open: [], sourcing: [], interviewing: [], trial: [], recommended: [] };
    for (const h of hires) {
      if (h.status in map) map[h.status].push(h);
    }
    return map;
  }, [hires]);

  return (
    <>
      <Topbar label="HR · TALENT" />
      <main className="cockpit-main">
        <h1 className="cockpit-h1">
          <Pulse color="var(--d-hr)" /> <b>HR · TALENT</b> · {hires.length} OPEN PIPELINE{hires.length === 1 ? "" : "S"} · {templates.length} TEMPLATES
        </h1>
        <p className="cockpit-display">
          Hire for <em>outcomes</em>, not <em>titles</em>.
        </p>
        <p className="cockpit-lede">
          {error ? `Error: ${error}` :
            "Trial agents only ever run on T3 credentials. The mint path requires an operator-approved scorecard — every hire ships with a name, a title, and a score."}
        </p>

        <div className="hr-kanban" style={{ marginTop: 16 }}>
          {STAGES.map((s) => (
            <div key={s.key} className="hr-lane" style={{ ["--accent" as string]: s.accent } as React.CSSProperties}>
              <h3>
                <span>{s.label}</span>
                <span>{(byStage[s.key] ?? []).length}</span>
              </h3>
              {(byStage[s.key] ?? []).map((h) => (
                <div key={h.id} className="hr-card" style={{ ["--accent" as string]: s.accent } as React.CSSProperties}>
                  <div className="name">{h.title}</div>
                  <div className="meta">{h.requestedTier ?? "T2"} · {h.requestedRoleTemplateKey ?? "no template"}</div>
                  {h.description ? <div className="pitch">{h.description}</div> : null}
                </div>
              ))}
              {(byStage[s.key] ?? []).length === 0 ? (
                <div style={{ color: "var(--mute)", fontFamily: "Geist Mono, monospace", fontSize: 11, padding: "8px 4px" }}>
                  empty
                </div>
              ) : null}
            </div>
          ))}
        </div>

        <h2 className="cockpit-h1" style={{ marginTop: 32 }}>
          <Pulse color="var(--d-hr)" /> <b>Role templates</b> · {templates.length}
        </h2>
        <p className="cockpit-lede">
          Default human names you can hire from. Operator can edit any name during the wizard or post-hire.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
          {templates.map((t) => {
            const accent = t.tier === "T1" ? "var(--t1)" : t.tier === "T3" ? "var(--t3)" : "var(--t2)";
            return (
              <div key={t.key} className="hr-card" style={{ ["--accent" as string]: accent } as React.CSSProperties}>
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <AvatarCircle
                    firstName={t.defaultFirstName}
                    lastName={t.defaultLastName}
                    accent={accent}
                    size={32}
                  />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <AgentLabel
                      humanFirstName={t.defaultFirstName}
                      humanLastName={t.defaultLastName}
                      title={t.title}
                    />
                    <div className="meta">{t.key} · {t.departmentKey}</div>
                  </div>
                  <span className={`tier t-${t.tier}`}>{t.tier}</span>
                </div>
                <div className="pitch">{t.pitch}</div>
                {/* Phase 10B.1 — Hire button. */}
                <div style={{ marginTop: 10, display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => setHireTemplate(t)}
                    disabled={!selectedCompany?.id}
                    style={{
                      padding: "5px 12px",
                      borderRadius: 4,
                      background: "color-mix(in oklch, " + accent + " 18%, transparent)",
                      color: accent,
                      border: "1px solid color-mix(in oklch, " + accent + " 35%, transparent)",
                      cursor: selectedCompany?.id ? "pointer" : "not-allowed",
                      fontFamily: "Geist Mono, monospace",
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      fontWeight: 600,
                      opacity: selectedCompany?.id ? 1 : 0.5,
                    }}
                  >
                    Hire ▸
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Phase 9.4 — sample scorecard panel + hire packet panel.
            Currently uses a fixed example rubric so the design renders
            even with no live candidates. Wire to a real candidate's
            latest scorecard via /api/candidates/:id/scorecards. */}
        <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 12, marginTop: 32 }}>
          <Panel
            label={<><Pulse color="var(--d-eng)" /> <b>Trial scorecard · sample rubric</b></>}
            accent="var(--d-eng)"
            glow
          >
            <div className="kv-list">
              {[
                { criterion: "Code quality", note: "Clean, testable", score: 4 },
                { criterion: "Speed", note: "Closed in 2 turns", score: 5 },
                { criterion: "Cost discipline", note: "Within T3 budget", score: 4 },
                { criterion: "Communication", note: "Asked one good clarification", score: 3 },
                { criterion: "Evidence quality", note: "Linked diff + test run", score: 4 },
              ].map((row) => (
                <div key={row.criterion} className="row">
                  <span>
                    <span style={{ color: "var(--ink)", fontWeight: 500 }}>{row.criterion}</span>
                    <div className="meta" style={{ color: "var(--mute)", fontFamily: "Geist Mono, monospace", fontSize: 11 }}>{row.note}</div>
                  </span>
                  <b><StarBar score={row.score} accent="var(--d-eng)" width={100} /></b>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            label={<><Pulse color="var(--gold)" /> <b>Hire packet · proposed</b></>}
            accent="var(--gold)"
          >
            <div style={{ padding: 16, display: "flex", gap: 14, alignItems: "flex-start" }}>
              <AvatarCircle firstName="J" lastName="B" accent="var(--gold)" size={48} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: "Geist Mono, monospace", fontSize: 11, color: "var(--mute)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                  candidate · proposed
                </div>
                <div style={{ fontSize: 16, fontWeight: 500, color: "var(--ink)", marginTop: 2 }}>
                  Jules Bernard <span style={{ color: "var(--mute)" }}>· Software Engineer</span>
                </div>
                <div className="kv-list" style={{ paddingTop: 12, padding: 0, marginTop: 10 }}>
                  {[
                    ["role", "eng.ic"], ["tier", "T3"], ["autonomy", "L1"],
                    ["budget", "$10/mo"], ["skills", "openai_compatible"], ["probation", "10 runs"],
                  ].map(([k, v]) => (
                    <div key={k} className="row">
                      <span>{k}</span>
                      <b>{v}</b>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </main>
      {/* Phase 10B.1 — Hire dialog overlay. */}
      {hireTemplate && selectedCompany?.id ? (
        <HireDialog
          companyId={selectedCompany.id}
          template={hireTemplate}
          onClose={() => setHireTemplate(null)}
          onMinted={(agent) => {
            setToast(`Hired ${agent.name}`);
            void reloadHires();
            window.setTimeout(() => setToast(null), 4000);
          }}
        />
      ) : null}
      {toast ? (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          background: "color-mix(in oklch, var(--t3) 18%, var(--panel))",
          border: "1px solid color-mix(in oklch, var(--t3) 35%, var(--line))",
          color: "var(--ink)", padding: "10px 18px", borderRadius: 8, zIndex: 200,
          fontFamily: "Geist Mono, monospace", fontSize: 11,
          boxShadow: "0 8px 32px -12px color-mix(in oklch, var(--t3) 60%, transparent)",
        }}>
          ✓ {toast}
        </div>
      ) : null}
    </>
  );
}
