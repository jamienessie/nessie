import { Outlet } from "react-router-dom";
import { useEffect } from "react";
import { Rail } from "./Rail";
import "./tokens.css";

// Cockpit shell. Replaces Layout for /tower, /meet, /hr, /org routes.
// Adds .cockpit-root to <body> so the gradient backdrop and font stack
// take effect, and removes them when the route exits.

export function CockpitShell() {
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
        <Outlet />
      </div>
    </div>
  );
}
