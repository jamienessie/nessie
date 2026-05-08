import type { CSSProperties } from "react";

// Burn bar for spend / quota / department health. Pass a 0..1 fraction
// and an optional accent oklch token.
export function BurnBar({ fraction, accent, height = 4 }: { fraction: number; accent?: string; height?: number }) {
  const clamped = Math.max(0, Math.min(1, fraction));
  const style: CSSProperties = { height };
  if (accent) (style as Record<string, string>)["--accent"] = accent;
  return (
    <div className="burn-bar" style={style}>
      <i style={{ width: `${clamped * 100}%` }} />
    </div>
  );
}
