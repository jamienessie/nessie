import { useEffect, useState } from "react";
import { api } from "@/api/client";
import { Topbar, Panel, Pulse, KvList, type TopbarTierState } from "@/components/cockpit";

// Phase 9.3 — segmented spend gauge: 4 segments T1/T2/T3/headroom
// with white-25% inset glow per segment, matching the cockpit
// reference. Replaces the single-bar BurnBar in the Spend Today
// panel.
function SegmentedSpendGauge({
  cap, t1, t2, t3,
}: { cap: number; t1: number; t2: number; t3: number }) {
  const total = Math.max(0, t1 + t2 + t3);
  const safeCap = Math.max(cap, total + 1);
  const headroom = Math.max(0, safeCap - total);
  const seg = (cents: number, color: string, key: string) => {
    const pct = (cents / safeCap) * 100;
    if (pct <= 0) return null;
    return (
      <span key={key} style={{
        width: `${pct}%`, height: "100%", background: color,
        boxShadow: "inset 0 0 0 1px color-mix(in oklch, white 25%, transparent)",
      }} />
    );
  };
  return (
    <div style={{
      display: "flex", height: 40, borderRadius: 6, overflow: "hidden",
      background: "var(--line-soft)", border: "1px solid var(--line)",
    }}>
      {seg(t1, "var(--t1)", "t1")}
      {seg(t2, "var(--t2)", "t2")}
      {seg(t3, "var(--t3)", "t3")}
      {seg(headroom, "var(--panel-2)", "head")}
    </div>
  );
}

// Cockpit Control Tower.
//
// Phase 5 ships a structurally faithful version of the design with live
// data where it exists today and labelled placeholders for surfaces that
// land in later phases:
//   - 3 tier panels (T1/T2/T3) — counts from /api/agents grouped by tier;
//     spend from /api/costs/today (sum of cost_events).
//   - Subscription health — proxy /v1/health + per-credential row from
//     /api/credentials (Phase 6 endpoint; placeholder here).
//   - Active runs feed — /api/agents/active + /api/heartbeat-runs/active
//     (placeholder; iterates whatever rows exist).
//   - War room / approvals queue / live metrics — labelled placeholders.

type AgentRow = {
  id: string;
  name: string;
  humanFirstName?: string | null;
  humanLastName?: string | null;
  title?: string | null;
  tier?: "T1" | "T2" | "T3" | null;
  status: string;
  adapterType: string;
};

type CostsToday = {
  byTier: { T1: number; T2: number; T3: number };
  total: number;
};

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function ControlTower() {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [costs, setCosts] = useState<CostsToday | null>(null);
  const [proxyOk, setProxyOk] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const agentsRes = await api.get<{ agents: AgentRow[] }>("/agents").catch(() => ({ agents: [] as AgentRow[] }));
        const costsRes = await api.get<CostsToday>("/costs/today").catch(() => null);
        if (cancelled) return;
        setAgents(agentsRes.agents ?? []);
        setCosts(costsRes);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    // Probe proxy /v1/health from the server-side proxy on :7777.
    fetch("http://127.0.0.1:7777/v1/health", { mode: "cors" })
      .then((r) => setProxyOk(r.ok))
      .catch(() => setProxyOk(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const byTier = agents.reduce(
    (acc, a) => {
      const t = a.tier ?? "T2";
      if (t === "T1" || t === "T2" || t === "T3") {
        acc[t].active += 1;
      }
      return acc;
    },
    { T1: { active: 0 }, T2: { active: 0 }, T3: { active: 0 } } as Record<"T1" | "T2" | "T3", { active: number }>,
  );

  const tierState: TopbarTierState = {
    t1: { active: byTier.T1.active, spendCents: costs?.byTier?.T1 ?? 0 },
    t2: { active: byTier.T2.active, spendCents: costs?.byTier?.T2 ?? 0 },
    t3: { active: byTier.T3.active, spendCents: costs?.byTier?.T3 ?? 0 },
    warn: proxyOk === false ? { count: 1, reason: "proxy unreachable" } : undefined,
  };

  const today = new Date();
  const dateLabel = today
    .toLocaleDateString("en-GB", { month: "short", day: "numeric", weekday: "short" })
    .toUpperCase();
  const inFlight = agents.filter((a) => a.status === "running" || a.status === "active").length;

  return (
    <>
      <Topbar tierState={tierState} label="CONTROL TOWER" />
      <main className="cockpit-main">
        <h1 className="cockpit-h1">
          <Pulse color="var(--t3)" /> <b>CONTROL TOWER</b> · {dateLabel} · {inFlight} IN FLIGHT
        </h1>
        <p className="cockpit-display">
          {agents.length === 0 ? (
            <>An empty company is <em>still a company</em>.</>
          ) : (
            <>
              {agents.length} {agents.length === 1 ? "agent" : "agents"} on the roster, <em>{inFlight}</em> in flight.
            </>
          )}
        </p>
        <p className="cockpit-lede">
          {error
            ? `Error loading: ${error}`
            : "Live tier rollup. T1 subscription seats absorb the senior judgment work; T2 paid APIs route the bulk; T3 free credits handle the long tail."}
        </p>

        {/* 3 tier panels */}
        <section style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {(["T1", "T2", "T3"] as const).map((tier) => {
            const accent =
              tier === "T1" ? "var(--t1)" : tier === "T2" ? "var(--t2)" : "var(--t3)";
            const subtitle = tier === "T1" ? "SUBSCRIPTION" : tier === "T2" ? "PAID API" : "FREE / CHEAP";
            const count = byTier[tier].active;
            const spend = costs?.byTier?.[tier] ?? 0;
            return (
              <div key={tier} className="gt-tier" style={{ ["--accent" as string]: accent } as React.CSSProperties}>
                <div className="head"><Pulse /> {tier} · {subtitle}</div>
                <div className="big">
                  {tier === "T1" || tier === "T3" ? count : fmtCents(spend).replace("$", "$")}
                  {tier === "T1" || tier === "T3" ? <small>{count === 1 ? "agent" : "agents"}</small> : null}
                </div>
                <div className="meta">
                  <div><span>spend today</span><b>{fmtCents(spend)}</b></div>
                  <div><span>active</span><b>{count}</b></div>
                  <div><span>tier policy</span><b>{tier === "T1" ? "Conservative" : tier === "T2" ? "auto" : "burst-OK"}</b></div>
                </div>
              </div>
            );
          })}
        </section>

        {/* Active runs feed */}
        <div style={{ display: "grid", gridTemplateColumns: "8fr 4fr", gap: 12, marginTop: 12 }}>
          <Panel label={<><Pulse color="var(--t3)" /> <b>Active runs</b></>} accent="var(--t2)">
            {agents.length === 0 ? (
              <div className="cockpit-empty"><b>No agents yet.</b>Hire your first one in HR to start scheduling runs.</div>
            ) : (
              <div className="feed">
                {agents.slice(0, 10).map((a) => {
                  const accent = a.tier === "T1" ? "var(--t1)" : a.tier === "T3" ? "var(--t3)" : "var(--t2)";
                  return (
                    <div key={a.id} className="row" style={{ ["--accent" as string]: accent } as React.CSSProperties}>
                      <span className={`tier t-${a.tier ?? "T2"}`}>{a.tier ?? "T2"}</span>
                      <div>
                        <div>{a.name}</div>
                        <div className="agent">{a.title ?? "—"} · {a.adapterType}</div>
                      </div>
                      <span className="num">{a.status}</span>
                      <span className="num">—</span>
                      <span className="num">—</span>
                      <div className="bar"><i style={{ width: a.status === "running" ? "62%" : "0%" }} /></div>
                    </div>
                  );
                })}
              </div>
            )}
          </Panel>

          <Panel label={<><Pulse /> <b>Spend today</b></>} accent="var(--gold)">
            <div style={{ padding: "14px 18px 18px" }}>
              <div style={{ fontFamily: "Geist Mono, monospace", fontSize: 32, color: "var(--ink)", letterSpacing: "-0.02em" }}>
                {costs ? fmtCents(costs.total) : "—"}
              </div>
              <div style={{ marginTop: 12 }}>
                <SegmentedSpendGauge
                  cap={10000}
                  t1={costs?.byTier?.T1 ?? 0}
                  t2={costs?.byTier?.T2 ?? 0}
                  t3={costs?.byTier?.T3 ?? 0}
                />
              </div>
              <div style={{ marginTop: 16 }}>
                <KvList rows={[
                  { key: "T1", value: <span style={{ color: "var(--t1)" }}>{fmtCents(costs?.byTier?.T1 ?? 0)}</span> },
                  { key: "T2", value: <span style={{ color: "var(--t2)" }}>{fmtCents(costs?.byTier?.T2 ?? 0)}</span> },
                  { key: "T3", value: <span style={{ color: "var(--t3)" }}>{fmtCents(costs?.byTier?.T3 ?? 0)}</span> },
                ]} />
              </div>
            </div>
          </Panel>
        </div>

        {/* Subscription health + Approvals queue */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
          <Panel label={<><Pulse color={proxyOk ? "var(--t3)" : "var(--warn)"} /> <b>Cost-tier proxy</b></>} accent="var(--t2)">
            <KvList rows={[
              { key: "endpoint", value: <span className="mono">127.0.0.1:7777</span> },
              { key: "status", value: proxyOk === null ? "probing…" : proxyOk ? <span style={{ color: "var(--t3)" }}>healthy</span> : <span style={{ color: "var(--warn)" }}>unreachable</span> },
              { key: "TOS dial", value: "Conservative" },
              { key: "Anthropic translation", value: "Phase 6" },
            ]} />
          </Panel>
          <Panel label={<><Pulse color="var(--gold)" /> <b>Approvals queue</b></>} accent="var(--gold)">
            <div className="cockpit-empty"><b>No pending approvals.</b>Meeting outcomes and hire packets land here when they need your sign-off.</div>
          </Panel>
        </div>
      </main>
    </>
  );
}
