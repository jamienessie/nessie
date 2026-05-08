// Department-tinted avatar circle from the cockpit reference. Initials
// derived from the agent's display name (first letters of first +
// last). Used in meeting transcript turn rows and hire packet cards.

import type { CSSProperties } from "react";

export function AvatarCircle({
  firstName,
  lastName,
  fallback,
  accent = "var(--d-eng)",
  size = 36,
}: {
  firstName?: string | null;
  lastName?: string | null;
  fallback?: string | null;
  accent?: string;
  size?: number;
}) {
  const f = (firstName ?? "").trim();
  const l = (lastName ?? "").trim();
  let initials =
    `${f.charAt(0)}${l.charAt(0)}`.trim() ||
    (fallback ?? "").split(/\s+/).map((s) => s.charAt(0)).join("").slice(0, 2);
  if (!initials) initials = "?";
  const style: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    color: accent,
    background: `color-mix(in oklch, ${accent} 18%, var(--panel-2))`,
    border: `1px solid color-mix(in oklch, ${accent} 35%, var(--line))`,
    boxShadow: `0 0 14px -4px ${accent}`,
    fontFamily: "Geist Mono, ui-monospace, monospace",
    fontWeight: 600,
    fontSize: Math.round(size / 2.6),
    letterSpacing: "0.04em",
    flexShrink: 0,
  };
  return <span style={style} aria-hidden="true">{initials.toUpperCase()}</span>;
}
