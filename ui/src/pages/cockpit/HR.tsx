import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import { Topbar, Pulse, AgentLabel } from "@/components/cockpit";

// 5-stage kanban: Open → Sourcing → Interviewing → Trial → Recommended
// + an unobtrusive Hired/Rejected lane summary at the bottom.

type RoleTemplate = {
  key: string;
  defaultFirstName: string;
  defaultLastName: string;
  title: string;
  tier: "T1" | "T2" | "T3";
  departmentKey: string;
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
          {templates.map((t) => (
            <div key={t.key} className="hr-card" style={{
              ["--accent" as string]: t.tier === "T1" ? "var(--t1)" : t.tier === "T3" ? "var(--t3)" : "var(--t2)",
            } as React.CSSProperties}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <AgentLabel
                  humanFirstName={t.defaultFirstName}
                  humanLastName={t.defaultLastName}
                  title={t.title}
                />
                <span className={`tier t-${t.tier}`}>{t.tier}</span>
              </div>
              <div className="meta">{t.key} · {t.departmentKey}</div>
              <div className="pitch">{t.pitch}</div>
            </div>
          ))}
        </div>
      </main>
    </>
  );
}
