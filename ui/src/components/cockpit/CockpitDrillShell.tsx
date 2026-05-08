import { Outlet } from "react-router-dom";
import { useEffect } from "react";
import { Rail } from "./Rail";
import { Topbar } from "./Topbar";
import "./tokens.css";

// Plan §8.6 — non-destructive cockpit chrome around legacy drill-down
// pages (AgentDetail, IssueDetail, ApprovalDetail). The existing page
// content renders inside the cockpit grid + rail + topbar without any
// inner-content rewrite. Pixel refinement of the inner content is a
// separate Phase 9 commit.

export function CockpitDrillShell() {
  useEffect(() => {
    document.body.classList.add("cockpit-root");
    return () => {
      document.body.classList.remove("cockpit-root");
    };
  }, []);
  return (
    <div className="cockpit-app">
      <Rail />
      <div>
        <Topbar label="DRILL" />
        <main className="cockpit-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
