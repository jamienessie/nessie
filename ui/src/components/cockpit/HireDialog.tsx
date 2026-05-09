import { useEffect, useState } from "react";
import { api } from "@/api/client";

// Phase 10B.1 — minimal hire-from-template flow.
//
// Operator clicks "Hire" on a role template card -> this dialog opens
// with name + tier prefilled from the template -> on submit, fires the
// 4-call sequence (open hire -> add candidate -> walk transitions ->
// mint agent) -> calls onMinted with the new agent.

export interface HireDialogProps {
  companyId: string;
  template: {
    key: string;
    defaultFirstName: string;
    defaultLastName: string;
    title: string;
    tier: "T1" | "T2" | "T3";
    departmentKey: string;
    defaultAdapterType?: string;
  };
  onClose: () => void;
  onMinted?: (agent: { id: string; name: string }) => void;
}

export function HireDialog({ companyId, template, onClose, onMinted }: HireDialogProps) {
  const [first, setFirst] = useState(template.defaultFirstName);
  const [last, setLast] = useState(template.defaultLastName);
  const [tier, setTier] = useState<"T1" | "T2" | "T3">(template.tier);
  const [adapter, setAdapter] = useState(template.defaultAdapterType ?? "openai_compatible");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      // 1. Open the hire.
      const hireRes = await api.post<{ hire: { id: string } }>(
        `/hires?companyId=${encodeURIComponent(companyId)}`,
        {
          title: `Hire ${template.title}`,
          requestedRoleTemplateKey: template.key,
          requestedTier: tier,
        },
      );
      const hireId = hireRes.hire.id;

      // 2. Add the candidate.
      const candRes = await api.post<{ candidate: { id: string } }>(
        `/hires/${hireId}/candidates`,
        {
          humanFirstName: first,
          humanLastName: last,
          title: template.title,
          sourceTemplateKey: template.key,
          proposedAdapterType: adapter,
        },
      );
      const candId = candRes.candidate.id;

      // 3. Walk hire through to recommended.
      for (const to of ["sourcing", "interviewing", "trial", "recommended"] as const) {
        await api.post(
          `/hires/${hireId}/transition?companyId=${encodeURIComponent(companyId)}`,
          { to },
        );
      }

      // 4. Mint the agent.
      const mintRes = await api.post<{ agent: { id: string; name: string } }>(
        `/candidates/${candId}/hire?companyId=${encodeURIComponent(companyId)}`,
        {
          hireId,
          finalFirstName: first,
          finalLastName: last,
          finalTitle: template.title,
          finalTier: tier,
          finalAdapterType: adapter,
          roleTemplateKey: template.key,
        },
      );

      onMinted?.(mintRes.agent);
      onClose();
    } catch (caught) {
      setErr(caught instanceof Error ? caught.message : String(caught));
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "color-mix(in oklch, var(--bg) 70%, transparent)",
        backdropFilter: "blur(6px)",
        display: "grid", placeItems: "center",
      }}
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="panel"
        style={{ width: 440, maxWidth: "90vw", padding: 24, background: "var(--panel)" }}
      >
        <div className="mono" style={{ fontSize: 10, color: "var(--mute)", letterSpacing: "0.16em", textTransform: "uppercase" }}>
          Hire from template · {template.key}
        </div>
        <h2 style={{ margin: "8px 0 16px", fontSize: 22, fontWeight: 500, color: "var(--ink)", letterSpacing: "-0.01em" }}>
          {template.title}
        </h2>

        <label style={{ display: "block", marginBottom: 12 }}>
          <span className="mono" style={{ fontSize: 10, color: "var(--mute)", letterSpacing: "0.12em", textTransform: "uppercase" }}>First name</span>
          <input
            value={first}
            onChange={(e) => setFirst(e.target.value)}
            required
            style={inputStyle}
            disabled={busy}
          />
        </label>

        <label style={{ display: "block", marginBottom: 12 }}>
          <span className="mono" style={{ fontSize: 10, color: "var(--mute)", letterSpacing: "0.12em", textTransform: "uppercase" }}>Last name</span>
          <input
            value={last}
            onChange={(e) => setLast(e.target.value)}
            required
            style={inputStyle}
            disabled={busy}
          />
        </label>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 16 }}>
          <label>
            <span className="mono" style={{ fontSize: 10, color: "var(--mute)", letterSpacing: "0.12em", textTransform: "uppercase" }}>Tier</span>
            <select value={tier} onChange={(e) => setTier(e.target.value as never)} disabled={busy} style={inputStyle}>
              <option value="T1">T1 · subscription</option>
              <option value="T2">T2 · paid API</option>
              <option value="T3">T3 · free / cheap</option>
            </select>
          </label>
          <label>
            <span className="mono" style={{ fontSize: 10, color: "var(--mute)", letterSpacing: "0.12em", textTransform: "uppercase" }}>Adapter</span>
            <select value={adapter} onChange={(e) => setAdapter(e.target.value)} disabled={busy} style={inputStyle}>
              <option value="openai_compatible">openai_compatible</option>
              <option value="claude_local">claude_local</option>
              <option value="codex_local">codex_local</option>
              <option value="http_webhook">http_webhook</option>
            </select>
          </label>
        </div>

        {err ? (
          <div style={{ color: "var(--warn)", fontFamily: "Geist Mono, monospace", fontSize: 11, marginBottom: 12 }}>
            {err}
          </div>
        ) : null}

        <p style={{ fontSize: 12, color: "var(--mute)", margin: "0 0 16px" }}>
          Helper text: you can change these — agents go by whatever you call them.
        </p>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" onClick={onClose} disabled={busy} style={btnGhost}>Cancel</button>
          <button type="submit" disabled={busy || !first.trim() || !last.trim()} style={btnPrimary}>
            {busy ? "Hiring…" : `Hire ${first} ${last}`}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  display: "block", width: "100%", marginTop: 4, padding: "8px 10px",
  background: "var(--panel-2)", color: "var(--ink)",
  border: "1px solid var(--line)", borderRadius: 6,
  fontFamily: "Geist, sans-serif", fontSize: 13,
};
const btnGhost: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 6,
  background: "transparent", color: "var(--mute)",
  border: "1px solid var(--line)", cursor: "pointer",
  fontFamily: "Geist Mono, monospace", fontSize: 11,
};
const btnPrimary: React.CSSProperties = {
  padding: "8px 14px", borderRadius: 6,
  background: "var(--t3)", color: "var(--bg)",
  border: "1px solid var(--t3)", cursor: "pointer",
  fontFamily: "Geist Mono, monospace", fontSize: 11, fontWeight: 600,
};
