import { useEffect, useState } from "react";
import { Topbar, Panel, Pulse, AgentLabel, AvatarCircle, TierBadge } from "@/components/cockpit";
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

type Message = {
  id: string;
  meetingId: string;
  agentId: string | null;
  turnIndex: number;
  role: "agent" | "operator" | "system" | "tool";
  bodyMarkdown: string;
  costCents: number;
  createdAt: string;
};

export function CockpitMeetings() {
  const { selectedCompany } = useCompany();
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
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
        const res = await api.get<{ meeting: Meeting; participants: Participant[]; messages: Message[] }>(
          `/meetings/${activeId}?companyId=${encodeURIComponent(selectedCompany.id)}`,
        );
        if (!cancelled) {
          setParticipants(res.participants ?? []);
          setMessages(res.messages ?? []);
        }
      } catch {
        if (!cancelled) {
          setParticipants([]);
          setMessages([]);
        }
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
                {/* Phase 9.5 — transcript renderer. Avatar circle in
                    dept color, meta line (name + tier + role + ts),
                    body in 13.5px Geist. */}
                <div style={{ marginTop: 20 }}>
                  <div className="mono" style={{ color: "var(--mute)", fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>
                    Transcript ({messages.length})
                  </div>
                  {messages.length === 0 ? (
                    <div className="cockpit-empty">
                      <b>No messages yet.</b>Append via POST /api/meetings/:id/messages.
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      {messages.map((m) => {
                        const accent = m.role === "operator" ? "var(--gold)"
                          : m.role === "system" ? "var(--mute)"
                          : m.role === "tool" ? "var(--t3)"
                          : "var(--d-eng)";
                        const fallback = m.role === "operator" ? "Operator"
                          : m.role === "system" ? "System"
                          : m.role === "tool" ? "Tool"
                          : `agent ${(m.agentId ?? "—").slice(0, 8)}`;
                        return (
                          <div key={m.id} style={{ display: "grid", gridTemplateColumns: "36px 1fr", gap: 12, alignItems: "flex-start" }}>
                            <AvatarCircle fallback={fallback} accent={accent} size={36} />
                            <div style={{ minWidth: 0 }}>
                              <div className="mono" style={{ fontSize: 11, color: "var(--mute)", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                <span style={{ color: "var(--ink)", fontWeight: 600 }}>{fallback}</span>
                                <TierBadge tier={null}>{m.role.toUpperCase()}</TierBadge>
                                <span>turn {m.turnIndex}</span>
                                <span>·</span>
                                <span>{new Date(m.createdAt).toLocaleTimeString()}</span>
                                {m.costCents > 0 ? <span>· ${(m.costCents / 100).toFixed(2)}</span> : null}
                              </div>
                              <div style={{ fontSize: 13.5, lineHeight: 1.4, color: "var(--ink)", marginTop: 4, whiteSpace: "pre-wrap" }}>
                                {m.bodyMarkdown}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Panel>
        </div>
      </main>
    </>
  );
}
