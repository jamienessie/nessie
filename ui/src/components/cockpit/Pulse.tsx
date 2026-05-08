// Live indicator: a colored dot that emits a 1.6s pulse ring. Used in
// every cockpit panel header for the "this is live" reading. Color
// inherits from currentColor by default; pass an explicit token via
// the `color` prop (or wrap in a div with color set).

import type { CSSProperties } from "react";

export function Pulse({ color, style }: { color?: string; style?: CSSProperties }) {
  const composed: CSSProperties = { ...(style ?? {}) };
  if (color) composed.color = color;
  return <span className="pulse-d" style={composed} aria-hidden="true" />;
}
