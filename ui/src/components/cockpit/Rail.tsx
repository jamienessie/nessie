// Cockpit uses absolute /tower /meet /hr /org paths, so we bypass the
// company-prefixing Link wrapper from @/lib/router and use the raw
// react-router-dom version.
import { Link, useLocation } from "react-router-dom";

// Cockpit left rail. Four nav targets with department/tier accents:
//   /tower → control tower (T2 blue)
//   /meet  → meetings (eng indigo)
//   /hr    → HR pipeline (hr pink)
//   /org   → departments + roster (prod cyan)

const NAV_ITEMS = [
  { to: "/tower", label: "Tower", icon: "CT", accent: "var(--t2)" },
  { to: "/meet", label: "Meet", icon: "MT", accent: "var(--d-eng)" },
  { to: "/hr", label: "HR", icon: "HR", accent: "var(--d-hr)" },
  { to: "/org", label: "Org", icon: "OR", accent: "var(--d-prod)" },
] as const;

export function Rail() {
  const location = useLocation();
  const path = location.pathname;
  return (
    <aside className="cockpit-rail">
      <div className="logo">N</div>
      <div className="nav">
        {NAV_ITEMS.map((item) => {
          const active = path === item.to || path.startsWith(`${item.to}/`);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={`item${active ? " on" : ""}`}
              style={{ ["--accent" as string]: item.accent } as React.CSSProperties}
              aria-current={active ? "page" : undefined}
            >
              <span className="ico">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
      <div style={{ flex: 1 }} />
      <Link to="/dashboard" className="item" title="Switch to legacy view">
        <span className="ico">⤺</span>
        <span>legacy</span>
      </Link>
    </aside>
  );
}
