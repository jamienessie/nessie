/**
 * Canonical status & priority color definitions.
 *
 * Every component that renders a status indicator (StatusIcon, StatusBadge,
 * agent status dots, etc.) should import from here so colors stay consistent.
 *
 * Dark-mode tints use `bg-{hue}-500/20 text-{hue}-200` for stronger contrast
 * against dark surfaces — reads more confidently than the older /50 + 300 pair.
 */

// ---------------------------------------------------------------------------
// Issue status colors
// ---------------------------------------------------------------------------

/** StatusIcon circle: text + border classes */
export const issueStatusIcon: Record<string, string> = {
  backlog: "text-muted-foreground border-muted-foreground",
  todo: "text-blue-600 border-blue-600 dark:text-blue-400 dark:border-blue-400",
  in_progress: "text-yellow-600 border-yellow-600 dark:text-yellow-400 dark:border-yellow-400",
  in_review: "text-violet-600 border-violet-600 dark:text-violet-400 dark:border-violet-400",
  done: "text-green-600 border-green-600 dark:text-green-400 dark:border-green-400",
  cancelled: "text-neutral-500 border-neutral-500",
  blocked: "text-red-600 border-red-600 dark:text-red-400 dark:border-red-400",
};

export const issueStatusIconDefault = "text-muted-foreground border-muted-foreground";

/** Text-only color for issue statuses (dropdowns, labels) */
export const issueStatusText: Record<string, string> = {
  backlog: "text-muted-foreground",
  todo: "text-blue-600 dark:text-blue-400",
  in_progress: "text-yellow-600 dark:text-yellow-400",
  in_review: "text-violet-600 dark:text-violet-400",
  done: "text-green-600 dark:text-green-400",
  cancelled: "text-neutral-500",
  blocked: "text-red-600 dark:text-red-400",
};

export const issueStatusTextDefault = "text-muted-foreground";

// ---------------------------------------------------------------------------
// Badge colors — used by StatusBadge for all entity types
// ---------------------------------------------------------------------------

export const statusBadge: Record<string, string> = {
  // Agent statuses
  active: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200",
  running: "bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-200 animate-pulse",
  scheduled_retry: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200 animate-pulse",
  paused: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-200",
  idle: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-200",
  archived: "bg-muted text-muted-foreground",

  // Goal statuses
  planned: "bg-muted text-muted-foreground",
  achieved: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200",
  completed: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200",

  // Run statuses
  failed: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
  timed_out: "bg-orange-100 text-orange-700 dark:bg-orange-500/20 dark:text-orange-200",
  succeeded: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200",
  ok: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200",
  error: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
  info: "bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-200",
  terminated: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
  pending: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-200",

  // Approval statuses
  pending_approval: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200",
  revision_requested: "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200",
  approved: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200",
  rejected: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",

  // Issue statuses — consistent hues with issueStatusIcon above
  backlog: "bg-muted text-muted-foreground",
  todo: "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-200",
  in_progress: "bg-yellow-100 text-yellow-700 dark:bg-yellow-500/20 dark:text-yellow-200",
  in_review: "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200",
  blocked: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-200",
  done: "bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-200",
  cancelled: "bg-muted text-muted-foreground",
};

export const statusBadgeDefault = "bg-muted text-muted-foreground";

// ---------------------------------------------------------------------------
// Agent status dot — solid background for small indicator dots
// ---------------------------------------------------------------------------

export const agentStatusDot: Record<string, string> = {
  running: "bg-cyan-400 animate-pulse",
  active: "bg-green-400",
  paused: "bg-yellow-400",
  idle: "bg-yellow-400",
  pending_approval: "bg-amber-400",
  error: "bg-red-400",
  archived: "bg-neutral-400",
};

export const agentStatusDotDefault = "bg-neutral-400";

// ---------------------------------------------------------------------------
// Priority colors
// ---------------------------------------------------------------------------

export const priorityColor: Record<string, string> = {
  critical: "text-red-600 dark:text-red-400",
  high: "text-orange-600 dark:text-orange-400",
  medium: "text-yellow-600 dark:text-yellow-400",
  low: "text-blue-600 dark:text-blue-400",
};

export const priorityColorDefault = "text-yellow-600 dark:text-yellow-400";
