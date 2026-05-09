import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export const STACK_BORDER = "2px solid #0d0c10";
export const STACK_SHADOW = (c?: string) => `4px 4px 0 0 ${c || "#0d0c10"}`;
export const STACK_SHADOW_SM = "2px 2px 0 0 #0d0c10";

export const PASTEL_MAP: Record<string, string> = {
  "#FF4D2E": "#FFD1C4",
  "#FF8A1A": "#FFE0BB",
  "#FFC83A": "#FFF1B8",
  "#27D17F": "#C2EED8",
  "#1FA7FF": "#C8E5FF",
  "#7C5CFF": "#DDD2FF",
  "#FF3FA4": "#FFD2EA",
  "#00C2B5": "#BCEEE9",
  "#A4D81F": "#E2F2BC",
  "#FF6B9A": "#FFD3E1",
  "#FFB400": "#FFE6B5",
  "#5B8DEF": "#CFDDF8",
  "#B872FF": "#E5D3FF",
  "#22C2A4": "#BFEDE2",
};

export function pastel(hex: string): string {
  return PASTEL_MAP[hex] || "#FFF8E8";
}

export const ACCENTS: Record<string, string> = {
  dashboard: "#FF4D2E",
  inbox: "#FF8A1A",
  issues: "#FFC83A",
  routines: "#27D17F",
  goals: "#1FA7FF",
  org: "#7C5CFF",
  departments: "#FF3FA4",
  skills: "#00C2B5",
  activity: "#A4D81F",
  "chief-of-staff": "#FF6B9A",
  briefs: "#FFB400",
  hiring: "#5B8DEF",
  meetings: "#B872FF",
  "trust-layer": "#22C2A4",
  costs: "#FF8A1A",
  projects: "#1FA7FF",
  workspaces: "#7C5CFF",
  agents: "#27D17F",
};

export function getAccent(key: string): string {
  return ACCENTS[key] || "#0d0c10";
}

export function getPastel(key: string): string {
  return pastel(getAccent(key));
}

interface StackCardProps {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  accent?: string;
  flat?: boolean;
}

export function StackCard({ children, className, style, accent, flat }: StackCardProps) {
  return (
    <div
      className={cn("stack-card", className)}
      style={{
        boxShadow: flat ? "3px 3px 0 0 #0d0c10" : STACK_SHADOW(accent),
        ...style,
      }}
    >
      {children}
    </div>
  );
}

interface StackKpiProps {
  label: string;
  big: ReactNode;
  sub?: ReactNode;
  color: string;
  className?: string;
}

export function StackKpi({ label, big, sub, color, className }: StackKpiProps) {
  return (
    <div
      className={cn("stack-kpi flex flex-col gap-1 p-3", className)}
      style={{ ["--stack-pastel" as string]: pastel(color) }}
    >
      <div className="stack-mono-label">{label}</div>
      <div className="text-[26px] font-extrabold leading-none tracking-tight">{big}</div>
      {sub && <div className="text-[11px] font-semibold text-[#3a3340]">{sub}</div>}
    </div>
  );
}

interface StackPanelProps {
  title: ReactNode;
  color: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  flat?: boolean;
}

export function StackPanel({ title, color, right, children, className, flat }: StackPanelProps) {
  return (
    <div
      className={cn("stack-card flex flex-col min-h-0 overflow-hidden", className)}
      style={{ boxShadow: flat ? "3px 3px 0 0 #0d0c10" : STACK_SHADOW() }}
    >
      <div className="stack-panel-header" style={{ ["--stack-accent" as string]: color }}>
        <span className="w-3 h-3 rounded-full bg-[#0d0c10]" />
        <span>{title}</span>
        <span className="flex-1" />
        {right}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}

interface StackChipProps {
  children: ReactNode;
  color?: string;
  textColor?: string;
  className?: string;
}

export function StackChip({ children, color, textColor, className }: StackChipProps) {
  return (
    <span
      className={cn("stack-chip inline-block", className)}
      style={{
        background: color || "transparent",
        color: textColor || "#0d0c10",
      }}
    >
      {children}
    </span>
  );
}

interface StackButtonProps {
  children: ReactNode;
  color?: string;
  textColor?: string;
  className?: string;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  title?: string;
}

export function StackButton({ children, color, textColor, className, onClick, type = "button", disabled, title }: StackButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled}
      title={title}
      className={cn("stack-btn", className)}
      style={{
        background: color || "#fffaf0",
        color: textColor || "#0d0c10",
      }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

interface StackProgressProps {
  value: number;
  color: string;
  className?: string;
}

export function StackProgress({ value, color, className }: StackProgressProps) {
  return (
    <div className={cn("stack-progress", className)}>
      <div style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color }} />
    </div>
  );
}

interface StackStatusDotProps {
  color: string;
  className?: string;
}

export function StackStatusDot({ color, className }: StackStatusDotProps) {
  return (
    <span
      className={cn("inline-block rounded-full border-[1.5px] border-[#0d0c10]", className)}
      style={{ width: 10, height: 10, background: color }}
    />
  );
}

export function StackMono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cn("font-mono text-[10px] font-bold tracking-wide uppercase", className)}>{children}</span>;
}
