import { useEffect, useMemo, useState } from "react";
import { api } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";
import { Topbar, Panel, Pulse, AgentLabel } from "@/components/cockpit";

type Department = {
  id: string;
  key: string;
  name: string;
  color: string;
  mission: string;
  defaultPreferredTier: string;
  defaultBudgetMonthlyCents: number;
};

type AgentRow = {
  id: string;
  name: string;
  humanFirstName?: string | null;
  humanLastName?: string | null;
  title?: string | null;
  tier?: "T1" | "T2" | "T3" | null;
  departmentId?: string | null;
  status: string;
  reputationScore?: number;
  autonomyLevel?: number;
};

export function CockpitOrg() {
  const { selectedCompany } = useCompany();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Phase 9.6 — dept-filtered roster. Click a dept cell to focus.
  const [focusDeptId, setFocusDeptId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCompany?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [deptRes, agentsRes] = await Promise.all([
          api.get<{ departments: Department[] }>(`/departments?companyId=${encodeURIComponent(selectedCompany.id)}`),
          api.get<{ agents: AgentRow[] }>("/agents").catch(() => ({ agents: [] })),
        ]);
        if (cancelled) return;
        setDepartments(deptRes.departments ?? []);
        setAgents(agentsRes.agents ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCompany?.id]);

  const focusDept = useMemo(
    () => (focusDeptId ? departments.find((d) => d.id === focusDeptId) ?? null : null),
    [focusDeptId, departments],
  );
  const filteredAgents = useMemo(
    () => focusDeptId ? agents.filter((a) => a.departmentId === focusDeptId) : agents,
    [focusDeptId, agents],
  );

  const agentsByDept = useMemo(() => {
    const map = new Map<string, AgentRow[]>();
    for (const a of agents) {
      const key = a.departmentId ?? "_unassigned";
      const arr = map.get(key) ?? [];
      arr.push(a);
      map.set(key, arr);
    }
    return map;
  }, [agents]);

  return (
    <>
      <Topbar label="ORG · DEPARTMENTS" />
      <main className="cockpit-main">
        <h1 className="cockpit-h1">
          <Pulse color="var(--d-prod)" /> <b>ORG · DEPARTMENTS</b> · {departments.length} DEPTS · {agents.length} AGENT{agents.length === 1 ? "" : "S"}
        </h1>
        <p className="cockpit-display">
          A <em>company</em>, not a pile of bots.
        </p>
        <p className="cockpit-lede">
          {error ? `Error: ${error}` :
            "Departments own outcomes. Each one carries a mission, a default tier, a budget, and quality standards. Click a cell to drill into roster + open work contracts (Phase 6)."}
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 16 }}>
          {departments.map((d) => {
            const accent = d.color;
            const members = agentsByDept.get(d.id) ?? [];
            const live = members.filter((a) => a.status === "running" || a.status === "active").length;
            const burnFraction = members.length > 0 ? Math.min(1, live / members.length) : 0;
            return (
              <div
                key={d.id}
                className="dept-cell"
                style={{ ["--accent" as string]: accent, cursor: "pointer", outline: focusDeptId === d.id ? `2px solid ${accent}` : "none" } as React.CSSProperties}
                onClick={() => setFocusDeptId(focusDeptId === d.id ? null : d.id)}
              >
                <div>
                  <span className="swatch" />
                  <span className="name">{d.name}</span>
                </div>
                <div className="mission">{d.mission}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 6 }}>
                  <div>
                    <div className="mono" style={{ fontSize: 9, color: "var(--mute)", textTransform: "uppercase", letterSpacing: "0.12em" }}>members</div>
                    <div className="mono" style={{ fontSize: 18, color: accent }}>{members.length}</div>
                  </div>
                  <div>
                    <div className="mono" style={{ fontSize: 9, color: "var(--mute)", textTransform: "uppercase", letterSpacing: "0.12em" }}>live</div>
                    <div className="mono" style={{ fontSize: 18, color: accent }}>{live}</div>
                  </div>
                  <div>
                    <div className="mono" style={{ fontSize: 9, color: "var(--mute)", textTransform: "uppercase", letterSpacing: "0.12em" }}>tier</div>
                    <div className="mono" style={{ fontSize: 18, color: accent }}>{d.defaultPreferredTier}</div>
                  </div>
                </div>
                {/* Phase 9.6 — gate pills + bottom burn bar. */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 10 }}>
                  {(["evidence", "review", "policy"]).map((g) => (
                    <span
                      key={g}
                      style={{
                        fontFamily: "Geist Mono, monospace", fontSize: 9, letterSpacing: "0.1em",
                        textTransform: "uppercase", padding: "2px 6px", borderRadius: 4,
                        background: `color-mix(in oklch, ${accent} 14%, transparent)`,
                        color: accent,
                        border: `1px solid color-mix(in oklch, ${accent} 30%, transparent)`,
                      }}
                    >
                      {g}
                    </span>
                  ))}
                </div>
                <div className="burn-bar" style={{ marginTop: 12, ["--accent" as string]: accent } as React.CSSProperties}>
                  <i style={{ width: `${burnFraction * 100}%` }} />
                </div>
              </div>
            );
          })}
        </div>

        <Panel
          label={<>
            <Pulse color={focusDept?.color ?? "var(--d-eng)"} />
            <b>{focusDept ? `${focusDept.name} roster` : "Agent roster (all departments)"}</b>
            {focusDept ? (
              <button
                onClick={() => setFocusDeptId(null)}
                className="mono"
                style={{ marginLeft: "auto", background: "transparent", border: "1px solid var(--line)", color: "var(--mute)", padding: "2px 8px", borderRadius: 4, cursor: "pointer", fontSize: 10 }}
              >
                clear
              </button>
            ) : null}
          </>}
          accent={focusDept?.color ?? "var(--d-eng)"}
          style={{ marginTop: 24 }}
        >
          {filteredAgents.length === 0 ? (
            <div className="cockpit-empty"><b>No agents{focusDept ? ` in ${focusDept.name}` : " on the roster"} yet.</b>Hire from a role template in /hr.</div>
          ) : (
            <div className="kv-list">
              {filteredAgents.map((a) => (
                <div key={a.id} className="row">
                  <span style={{ color: "var(--ink)" }}>
                    <AgentLabel
                      humanFirstName={a.humanFirstName ?? ""}
                      humanLastName={a.humanLastName ?? ""}
                      title={a.title ?? ""}
                      fallbackName={a.name}
                      status={a.status === "paused" ? "paused" : null}
                    />
                  </span>
                  <b style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
                    {a.tier ? <span className={`tier t-${a.tier}`}>{a.tier}</span> : <span className="mute">no tier</span>}
                    <span className="mono" style={{ fontSize: 11, color: "var(--mute)" }}>L{a.autonomyLevel ?? 1}</span>
                    {/* Phase 9.6 — rep color thresholds: <50 warn, <80 gold, ≥80 t3. */}
                    <span className="mono" style={{
                      fontSize: 11,
                      color: (a.reputationScore ?? 50) < 50 ? "var(--warn)"
                        : (a.reputationScore ?? 50) < 80 ? "var(--gold)"
                        : "var(--t3)",
                      fontWeight: 600,
                    }}>
                      rep {a.reputationScore ?? 50}
                    </span>
                  </b>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </main>
    </>
  );
}
