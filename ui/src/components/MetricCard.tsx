import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "@/lib/router";

export type MetricCardTone = "neutral" | "success" | "warning" | "info" | "spend";

interface MetricCardProps {
  icon?: LucideIcon;
  value: string | number;
  label: string;
  description?: ReactNode;
  to?: string;
  onClick?: () => void;
  /** Raw background colour. If `tone` is also set, `tone` wins. */
  color?: string;
  /** Semantic tone — maps to a warm-palette background. Default is neutral cream. */
  tone?: MetricCardTone;
}

const TONE_COLOR: Record<MetricCardTone, string> = {
  neutral: "#FFF8E8",
  success: "#D4F2DC",
  warning: "#FFF1B8",
  info: "#D6E9F5",
  spend: "#FFE4D0",
};

export function MetricCard({
  icon: Icon,
  value,
  label,
  description,
  to,
  onClick,
  color,
  tone = "neutral",
}: MetricCardProps) {
  const isClickable = !!(to || onClick);
  const bg = color ?? TONE_COLOR[tone];

  const inner = (
    <div
      className={`h-full p-3 flex flex-col gap-1 transition-all${isClickable ? " hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-[5px_5px_0_0_#0d0c10] cursor-pointer" : ""}`}
      style={{
        background: bg,
        border: "2px solid #0d0c10",
        boxShadow: "4px 4px 0 0 #0d0c10",
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="font-mono text-[10px] font-bold tracking-[1.4px] uppercase text-[#0d0c10]">
          {label}
        </div>
        {Icon && <Icon className="size-3 shrink-0 text-[#0d0c10]" aria-hidden />}
      </div>
      <div className="text-[26px] font-extrabold leading-none tracking-tight text-[#0d0c10]">
        {value}
      </div>
      {description && (
        <div className="text-[11px] font-semibold text-[#3a3340] mt-0.5">{description}</div>
      )}
    </div>
  );

  if (to) {
    return (
      <Link to={to} className="no-underline text-inherit h-full block" onClick={onClick}>
        {inner}
      </Link>
    );
  }

  if (onClick) {
    return (
      <div className="h-full" onClick={onClick}>
        {inner}
      </div>
    );
  }

  return inner;
}
