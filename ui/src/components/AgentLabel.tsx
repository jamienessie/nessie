import { cn } from "../lib/utils";
import { getAgentAccent } from "../lib/agent-color";

export interface AgentLabelAgent {
  id?: string | null;
  name: string;
  /** Job title (e.g. "Senior Reviewer"). Preferred over role for display. */
  title?: string | null;
  /** Functional role tag (e.g. "ceo", "engineer"). */
  role?: string | null;
}

export interface AgentLabelProps {
  agent: AgentLabelAgent;
  /** When true, render `title` (preferred) or `role` next to the name. */
  showRole?: boolean;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Phase 5 load-bearing primitive — always renders an agent as Name + (optional)
 * Title with a stable accent dot derived from the agent's id (or name as
 * fallback). Use this everywhere an agent appears in the Cockpit instead of
 * rendering `agent.name` as a bare string. Role/title strings are intentionally
 * separated by a middle dot so the visual grouping reads as one entity.
 */
export function AgentLabel({ agent, showRole, size = "md", className }: AgentLabelProps) {
  const accent = getAgentAccent(agent.id ?? agent.name);
  const dotSize = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";
  const textSize = size === "sm" ? "text-xs" : "text-sm";
  const subText = size === "sm" ? "text-[10px]" : "text-xs";
  const subtitle = showRole ? agent.title ?? agent.role ?? null : null;
  const ariaParts = [agent.name];
  if (subtitle) ariaParts.push(subtitle);
  return (
    <span
      className={cn("inline-flex items-center gap-1.5 align-baseline", textSize, className)}
      aria-label={ariaParts.join(" — ")}
    >
      <span
        aria-hidden="true"
        className={cn("inline-block flex-none rounded-full", dotSize, accent.bg)}
      />
      <span className="font-medium">{agent.name}</span>
      {subtitle ? (
        <span className={cn("text-foreground/60", subText)}>· {subtitle}</span>
      ) : null}
    </span>
  );
}
