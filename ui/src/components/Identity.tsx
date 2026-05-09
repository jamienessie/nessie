import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAgentAccent } from "@/lib/agent-color";

type IdentitySize = "xs" | "sm" | "default" | "lg";

export interface IdentityProps {
  name: string;
  /** Agent id used to derive a deterministic accent color for the avatar bubble. */
  agentId?: string | null;
  avatarUrl?: string | null;
  initials?: string;
  size?: IdentitySize;
  className?: string;
}

export function deriveInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const textSize: Record<IdentitySize, string> = {
  xs: "text-sm",
  sm: "text-xs",
  default: "text-sm",
  lg: "text-sm",
};

export function Identity({ name, agentId, avatarUrl, initials, size = "default", className }: IdentityProps) {
  const displayInitials = initials ?? deriveInitials(name);
  const accent = getAgentAccent(agentId ?? name);
  const fallbackClass = agentId || name ? cn(accent.bg, accent.text, "font-semibold") : undefined;

  return (
    <span className={cn("inline-flex gap-1.5 items-center", size === "xs" && "gap-1", size === "lg" && "gap-2", className)}>
      <Avatar size={size}>
        {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
        <AvatarFallback className={fallbackClass}>{displayInitials}</AvatarFallback>
      </Avatar>
      <span className={cn("truncate", textSize[size])}>{name}</span>
    </span>
  );
}
