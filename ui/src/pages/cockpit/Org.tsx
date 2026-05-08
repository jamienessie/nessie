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
            return (
              <div key={d.id} className="dept-cell" style={{ ["--accent" as string]: accent } as React.CSSProperties}>
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
              </div>
            );
          })}
        </div>

        <Panel
          label={<><Pulse color="var(--d-eng)" /> <b>Agent roster</b></>}
          accent="var(--d-eng)"
          style={{ marginTop: 24 }}
        >
          {agents.length === 0 ? (
            <div className="cockpit-empty"><b>No agents on the roster yet.</b>Hire from a role template in /hr.</div>
          ) : (
            <div className="kv-list">
              {agents.map((a) => (
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
                  <b>
                    {a.tier ? <span className={`tier t-${a.tier}`}>{a.tier}</span> : <span className="mute">no tier</span>}
                    {" · L"}{a.autonomyLevel ?? 1}
                    {" · rep "}{a.reputationScore ?? 50}
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
