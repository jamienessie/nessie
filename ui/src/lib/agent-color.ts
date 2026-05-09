/**
 * Per-agent accent colors. Each agent gets a deterministic color tied to their
 * id (or, as a fallback, their name) — used in avatar bubbles, sidebar dots,
 * dashboard card strips, and activity rows so "who's who" is instantly
 * scannable across the UI.
 *
 * The palette deliberately excludes red and green to avoid colliding with
 * status semantics (red = error/destructive, green = succeeded/active).
 */

export interface AgentAccent {
  /** Tailwind class for solid background (avatar, dot) */
  bg: string;
  /** Tailwind class for foreground text on `bg` */
  text: string;
  /** Tailwind class for ring on focus / active */
  ring: string;
  /** Tailwind class for soft tinted background (cards, hover) */
  soft: string;
  /** Tailwind class for border accent */
  border: string;
  /** CSS hex for places that need a raw color value (gradient strips, charts) */
  hex: string;
}

const PALETTE: AgentAccent[] = [
  {
    bg: "bg-emerald-500 dark:bg-emerald-400",
    text: "text-emerald-50 dark:text-emerald-950",
    ring: "ring-emerald-400 dark:ring-emerald-300",
    soft: "bg-emerald-100 dark:bg-emerald-500/15",
    border: "border-emerald-300 dark:border-emerald-500/40",
    hex: "#10b981",
  },
  {
    bg: "bg-sky-500 dark:bg-sky-400",
    text: "text-sky-50 dark:text-sky-950",
    ring: "ring-sky-400 dark:ring-sky-300",
    soft: "bg-sky-100 dark:bg-sky-500/15",
    border: "border-sky-300 dark:border-sky-500/40",
    hex: "#0ea5e9",
  },
  {
    bg: "bg-violet-500 dark:bg-violet-400",
    text: "text-violet-50 dark:text-violet-950",
    ring: "ring-violet-400 dark:ring-violet-300",
    soft: "bg-violet-100 dark:bg-violet-500/15",
    border: "border-violet-300 dark:border-violet-500/40",
    hex: "#8b5cf6",
  },
  {
    bg: "bg-rose-500 dark:bg-rose-400",
    text: "text-rose-50 dark:text-rose-950",
    ring: "ring-rose-400 dark:ring-rose-300",
    soft: "bg-rose-100 dark:bg-rose-500/15",
    border: "border-rose-300 dark:border-rose-500/40",
    hex: "#f43f5e",
  },
  {
    bg: "bg-amber-500 dark:bg-amber-400",
    text: "text-amber-950 dark:text-amber-950",
    ring: "ring-amber-400 dark:ring-amber-300",
    soft: "bg-amber-100 dark:bg-amber-500/15",
    border: "border-amber-300 dark:border-amber-500/40",
    hex: "#f59e0b",
  },
  {
    bg: "bg-cyan-500 dark:bg-cyan-400",
    text: "text-cyan-50 dark:text-cyan-950",
    ring: "ring-cyan-400 dark:ring-cyan-300",
    soft: "bg-cyan-100 dark:bg-cyan-500/15",
    border: "border-cyan-300 dark:border-cyan-500/40",
    hex: "#06b6d4",
  },
  {
    bg: "bg-indigo-500 dark:bg-indigo-400",
    text: "text-indigo-50 dark:text-indigo-950",
    ring: "ring-indigo-400 dark:ring-indigo-300",
    soft: "bg-indigo-100 dark:bg-indigo-500/15",
    border: "border-indigo-300 dark:border-indigo-500/40",
    hex: "#6366f1",
  },
  {
    bg: "bg-fuchsia-500 dark:bg-fuchsia-400",
    text: "text-fuchsia-50 dark:text-fuchsia-950",
    ring: "ring-fuchsia-400 dark:ring-fuchsia-300",
    soft: "bg-fuchsia-100 dark:bg-fuchsia-500/15",
    border: "border-fuchsia-300 dark:border-fuchsia-500/40",
    hex: "#d946ef",
  },
  {
    bg: "bg-lime-500 dark:bg-lime-400",
    text: "text-lime-950 dark:text-lime-950",
    ring: "ring-lime-400 dark:ring-lime-300",
    soft: "bg-lime-100 dark:bg-lime-500/15",
    border: "border-lime-300 dark:border-lime-500/40",
    hex: "#84cc16",
  },
  {
    bg: "bg-orange-500 dark:bg-orange-400",
    text: "text-orange-50 dark:text-orange-950",
    ring: "ring-orange-400 dark:ring-orange-300",
    soft: "bg-orange-100 dark:bg-orange-500/15",
    border: "border-orange-300 dark:border-orange-500/40",
    hex: "#f97316",
  },
];

const NEUTRAL: AgentAccent = {
  bg: "bg-muted",
  text: "text-muted-foreground",
  ring: "ring-border",
  soft: "bg-muted",
  border: "border-border",
  hex: "#71717a",
};

/**
 * Stable 32-bit FNV-1a hash. Same input → same color across sessions and
 * across machines — no DB column required.
 */
function fnv1aHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = (hash + ((hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24))) >>> 0;
  }
  return hash;
}

/**
 * Resolve an accent for an agent. Pass `agentId` when available — falls back
 * to `name` so the same agent always renders the same color even before
 * persistence. When neither is present, returns a neutral gray accent.
 */
export function getAgentAccent(seed: string | null | undefined): AgentAccent {
  if (!seed || !seed.trim()) return NEUTRAL;
  const idx = fnv1aHash(seed.trim().toLowerCase()) % PALETTE.length;
  return PALETTE[idx];
}

/** Exposed for the DesignGuide showcase. */
export function listAgentAccents(): AgentAccent[] {
  return [...PALETTE];
}
