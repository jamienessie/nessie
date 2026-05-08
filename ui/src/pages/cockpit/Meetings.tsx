import { useEffect, useState } from "react";
import { Topbar, Panel, Pulse, AgentLabel } from "@/components/cockpit";
import { api } from "@/api/client";
import { useCompany } from "@/context/CompanyContext";

type Meeting = {
  id: string;
  title: string;
  mode: string;
  state: string;
  scheduledAt: string | null;
  startedAt: string | null;
  spentCents: number;
  budgetCents: number;
  turnIndex: number;
  turnLimit: number;
};

type Participant = {
  id: string;
  agentId: string;
  role: string;
};

export function CockpitMeetings() {
  const { selectedCompany } = useCompany();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCompany?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ meetings: Meeting[] }>(
          `/meetings?companyId=${encodeURIComponent(selectedCompany.id)}`,
        );
        if (cancelled) return;
        setMeetings(res.meetings ?? []);
        if (res.meetings?.[0] && !activeId) setActiveId(res.meetings[0].id);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCompany?.id, activeId]);

  useEffect(() => {
    if (!activeId || !selectedCompany?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await api.get<{ meeting: Meeting; participants: Participant[] }>(
          `/meetings/${activeId}?companyId=${encodeURIComponent(selectedCompany.id)}`,
        );
        if (!cancelled) setParticipants(res.participants ?? []);
      } catch {
        if (!cancelled) setParticipants([]);
      }
    })();
    return () => { cancelled = true; };
  }, [activeId, selectedCompany?.id]);

  const active = meetings.find((m) => m.id === activeId) ?? null;

  return (
    <>
      <Topbar label="MEETINGS" />
      <main className="cockpit-main">
        <h1 className="cockpit-h1">
          <Pulse color="var(--d-eng)" /> <b>MEETINGS</b> · {meetings.length} ROOM{meetings.length === 1 ? "" : "S"}
        </h1>
        <p className="cockpit-display">
          {meetings.length === 0 ? <>No <em>rooms</em> yet.</> : <><em>{meetings.length}</em> live decisions in progress.</>}
        </p>
        <p className="cockpit-lede">
          {error ? `Error: ${error}` :
            "Meetings produce decisions, not chat. Every closed meeting must surface at least one DECIDE / ACTION / MEMORY / ISSUE outcome — proposed by the agents, approved by you."}
        </p>

        <div className="meet-grid">
          <div>
            <Panel label={<><Pulse color="var(--d-eng)" /> <b>Rooms</b></>} accent="var(--d-eng)">
              {meetings.length === 0 ? (
                <div className="cockpit-empty"><b>No meetings yet.</b>Start one from an issue or hire pipeline.</div>
              ) : (
                <div className="meet-list" style={{ padding: 12 }}>
                  {meetings.map((m) => (
                    <div
                      key={m.id}
                      className={`meet-item${m.id === activeId ? " on" : ""}`}
                      onClick={() => setActiveId(m.id)}
                    >
                      <div className="title">{m.title}</div>
                      <div className="meta">{m.mode.replace("_", " ")} · {m.state} · turn {m.turnIndex}/{m.turnLimit}</div>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          </div>

          <Panel
            label={<><Pulse color="var(--d-eng)" /> <b>{active?.title ?? "no room selected"}</b></>}
            accent="var(--d-eng)"
            glow
          >
            {!active ? (
              <div className="cockpit-empty"><b>Select a room.</b>Or create one from /api/meetings.</div>
            ) : (
              <div style={{ padding: 16 }}>
                <div className="mono" style={{ color: "var(--mute)", fontSize: 11, letterSpacing: "0.08em" }}>
                  STATE {active.state} · TURN {active.turnIndex}/{active.turnLimit} · ${(active.spentCents / 100).toFixed(2)} of ${(active.budgetCents / 100).toFixed(2)}
                </div>
                <div style={{ marginTop: 16 }}>
                  <strong>Participants ({participants.length})</strong>
                  <ul style={{ margin: "8px 0", padding: 0, listStyle: "none" }}>
                    {participants.map((p) => (
                      <li key={p.id} style={{ padding: "6px 0" }}>
                        <AgentLabel humanFirstName="" humanLastName="" title="" fallbackName={`agent ${p.agentId.slice(0, 8)}`} />
                        <span className="mono" style={{ color: "var(--mute)", marginLeft: 8, fontSize: 11 }}>{p.role}</span>
                      </li>
                    ))}
                    {participants.length === 0 && (
                      <li style={{ color: "var(--mute)", fontFamily: "Geist Mono, monospace", fontSize: 11 }}>none yet</li>
                    )}
                  </ul>
                </div>
                <div className="cockpit-empty" style={{ marginTop: 16 }}>
                  <b>Live transcript lands in Phase 6.</b>For now, append messages via POST /api/meetings/:id/messages.
                </div>
              </div>
            )}
          </Panel>
        </div>
      </main>
    </>
  );
}
