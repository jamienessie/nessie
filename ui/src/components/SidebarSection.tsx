import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type SidebarTone = "work" | "company" | "operator" | "neutral";

interface SidebarSectionProps {
  label: string;
  tone?: SidebarTone;
  children: ReactNode;
}

const toneLabelClass: Record<SidebarTone, string> = {
  work: "text-[var(--tone-work-fg)]",
  company: "text-[var(--tone-company-fg)]",
  operator: "text-[var(--tone-operator-fg)]",
  neutral: "text-muted-foreground/60",
};

export function SidebarSection({ label, tone = "neutral", children }: SidebarSectionProps) {
  return (
    <div>
      <div
        className={cn(
          "px-3 py-1.5 text-[10px] font-medium uppercase tracking-widest font-mono",
          toneLabelClass[tone],
        )}
      >
        {label}
      </div>
      <div className="flex flex-col gap-0.5 mt-0.5">{children}</div>
    </div>
  );
}
