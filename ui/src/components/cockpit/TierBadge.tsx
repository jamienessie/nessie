import type { ReactNode } from "react";

// Tier ribbon. T1 magenta, T2 blue, T3 green, warn red. Pass `paused`
// to render the warn variant (with a "PAUSED" label).
export type TierBadgeProps = {
  tier?: "T1" | "T2" | "T3" | null;
  paused?: boolean;
  children?: ReactNode;
};

export function TierBadge({ tier, paused, children }: TierBadgeProps) {
  if (paused) {
    return <span className="tier t-warn">{children ?? "PAUSED"}</span>;
  }
  const t = tier ?? "T2";
  return <span className={`tier t-${t}`}>{children ?? t}</span>;
}
