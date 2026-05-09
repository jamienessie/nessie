import type { ReactNode } from "react";

export type SidebarTone = "work" | "company" | "operator" | "neutral";

interface SidebarSectionProps {
  label: string;
  /** Optional tone — overrides the default muted label colour. Maps to the brutalist warm palette. */
  tone?: SidebarTone;
  children: ReactNode;
}

const TONE_COLOR: Record<SidebarTone, string> = {
  // Sticking to the warm-palette neutrals; tones nudge the label hue without
  // breaking the cream/black aesthetic.
  neutral: "#5a525e",
  work: "#3863a0",     // muted indigo for "work"
  company: "#7a3a8a",  // muted violet for "company"
  operator: "#a05a1f", // muted amber for "operator"
};

export function SidebarSection({ label, tone = "neutral", children }: SidebarSectionProps) {
  return (
    <div>
      <div
        className="px-1 pb-1.5 pt-2 text-[9.5px] font-bold uppercase tracking-[1.6px] font-mono"
        style={{ color: TONE_COLOR[tone] }}
      >
        {label} —
      </div>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}
