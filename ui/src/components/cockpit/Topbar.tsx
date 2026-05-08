import { useEffect, useState } from "react";
import { Pulse } from "./Pulse";

// Cockpit topbar: status timestamp + tier strip + theme toggle.
//
// The tier strip shows live counts/spend per cost tier. Phase 5 ships
// with a static call to /api/agents/count-by-tier replaced with a
// real query; until then placeholders surface so the operator sees
// the structure.

export type TopbarTierState = {
  t1: { active: number; spendCents: number };
  t2: { active: number; spendCents: number };
  t3: { active: number; spendCents: number };
  warn?: { count: number; reason?: string };
};

const THEME_KEY = "nessie.theme";

function readTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "dark";
  const stored = window.localStorage.getItem(THEME_KEY);
  return stored === "light" ? "light" : "dark";
}

function writeTheme(theme: "dark" | "light") {
  document.documentElement.classList.toggle("dark", theme === "dark");
  document.documentElement.style.colorScheme = theme;
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // localStorage may be disabled — silently no-op.
  }
}

function fmtCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function Topbar({ tierState, label }: { tierState?: TopbarTierState; label?: string }) {
  const [theme, setTheme] = useState<"dark" | "light">(readTheme);
  useEffect(() => {
    writeTheme(theme);
  }, [theme]);

  const t = tierState ?? {
    t1: { active: 0, spendCents: 0 },
    t2: { active: 0, spendCents: 0 },
    t3: { active: 0, spendCents: 0 },
  };
  const heading = label ?? "COCKPIT";

  return (
    <div className="cockpit-top">
      <span className="ts">
        <b>NESSIE</b> · {heading} · <Pulse color="var(--t3)" /> live
      </span>
      <div className="strip">
        <span className="kv">
          <i className="d" style={{ background: "var(--t1)" }} />
          <b>T1</b> {t.t1.active} active · {fmtCents(t.t1.spendCents)}
        </span>
        <span className="kv">
          <i className="d" style={{ background: "var(--t2)" }} />
          <b>T2</b> {t.t2.active} routing · {fmtCents(t.t2.spendCents)}
        </span>
        <span className="kv">
          <i className="d" style={{ background: "var(--t3)" }} />
          <b>T3</b> {t.t3.active} ic · {fmtCents(t.t3.spendCents)}
        </span>
        {t.warn ? (
          <span className="kv" style={{ color: "var(--warn)" }}>
            <i className="d" />
            <b>WARN</b> {t.warn.reason ?? `${t.warn.count} alert${t.warn.count === 1 ? "" : "s"}`}
          </span>
        ) : null}
      </div>
      <button className="toggle" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
        {theme === "dark" ? "☾ dark" : "☀ light"}
      </button>
    </div>
  );
}
