import { type CSSProperties } from "react";

// Nessie's load-bearing identity primitive. Every agent reference in the
// Cockpit UI must render through this component — never a bare ID, never
// a name without a title. See plan Section 3.
//
// The component is intentionally minimal: it receives the parts it needs
// and renders them in the canonical order ("First Last · Title"). It
// makes no assumptions about where the agent came from (live API row,
// candidate, role template) — callers pass the parts.
//
// `nameOnly` is NOT supported. If a caller has only a first name or only
// a title, they're rendering an unfinished record and the API contract
// (see plan §3 schema invariants) was violated upstream.

export type AgentLabelInput = {
  humanFirstName: string;
  humanLastName: string;
  title: string;
  /** Optional decoration: 'paused' | 'on_probation' | 'suspended' | null */
  status?: string | null;
  /** Optional fallback if both name parts are empty — legacy/imported agents. */
  fallbackName?: string | null;
};

export type AgentLabelProps = AgentLabelInput & {
  variant?: "dot" | "dash";
  className?: string;
  style?: CSSProperties;
};

export function buildAgentDisplayParts(input: AgentLabelInput) {
  const first = (input.humanFirstName ?? "").trim();
  const last = (input.humanLastName ?? "").trim();
  const display = `${first} ${last}`.trim();
  const displayName = display.length > 0 ? display : (input.fallbackName ?? "").trim();
  const titleLabel = (input.title ?? "").trim();
  return { displayName, titleLabel };
}

export function AgentLabel(props: AgentLabelProps) {
  const { displayName, titleLabel } = buildAgentDisplayParts(props);
  const sep = props.variant === "dash" ? "—" : "·";
  const pillState =
    props.status === "paused" || props.status === "on_probation" || props.status === "suspended"
      ? props.status.replace(/_/g, " ")
      : null;

  return (
    <span className={`agent-label${props.className ? ` ${props.className}` : ""}`} style={props.style}>
      <span className="name">{displayName || "(unnamed agent)"}</span>
      {titleLabel ? (
        <>
          <span className="sep" aria-hidden="true">{sep}</span>
          <span className="title-label">{titleLabel}</span>
        </>
      ) : null}
      {pillState ? <span className="pill">{pillState}</span> : null}
    </span>
  );
}
