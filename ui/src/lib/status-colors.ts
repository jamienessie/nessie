/**
 * Canonical status & priority color definitions.
 *
 * Every component that renders a status indicator (StatusIcon, StatusBadge,
 * agent status dots, etc.) should import from here so colors stay consistent.
 */

// ---------------------------------------------------------------------------
// Issue status colors
// ---------------------------------------------------------------------------

/** StatusIcon circle: text + border classes */
export const issueStatusIcon: Record<string, string> = {
  backlog: "text-[#5a525e] border-[#5a525e]",
  todo: "text-[#1FA7FF] border-[#1FA7FF]",
  in_progress: "text-[#FFC83A] border-[#FFC83A]",
  in_review: "text-[#7C5CFF] border-[#7C5CFF]",
  done: "text-[#27D17F] border-[#27D17F]",
  cancelled: "text-[#5a525e] border-[#5a525e]",
  blocked: "text-[#FF4D2E] border-[#FF4D2E]",
};

export const issueStatusIconDefault = "text-[#5a525e] border-[#5a525e]";

/** Text-only color for issue statuses (dropdowns, labels) */
export const issueStatusText: Record<string, string> = {
  backlog: "text-[#5a525e]",
  todo: "text-[#1FA7FF]",
  in_progress: "text-[#FFC83A]",
  in_review: "text-[#7C5CFF]",
  done: "text-[#27D17F]",
  cancelled: "text-[#5a525e]",
  blocked: "text-[#FF4D2E]",
};

export const issueStatusTextDefault = "text-[#5a525e]";

// ---------------------------------------------------------------------------
// Badge colors — used by StatusBadge for all entity types
// ---------------------------------------------------------------------------

export const statusBadge: Record<string, string> = {
  // Agent statuses
  active: "bg-[#C2EED8] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  running: "bg-[#C8E5FF] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  scheduled_retry: "bg-[#CFDDF8] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  paused: "bg-[#FFE0BB] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  idle: "bg-[#FFF1B8] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  archived: "bg-[#FFF8E8] text-[#5a525e] border-[1.5px] border-[#0d0c10]",

  // Goal statuses
  planned: "bg-[#FFF8E8] text-[#5a525e] border-[1.5px] border-[#0d0c10]",
  achieved: "bg-[#C2EED8] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  completed: "bg-[#C2EED8] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",

  // Run statuses
  failed: "bg-[#FFD1C4] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  timed_out: "bg-[#FFE0BB] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  succeeded: "bg-[#C2EED8] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  ok: "bg-[#C2EED8] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  warning: "bg-[#FFF1B8] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  error: "bg-[#FFD1C4] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  info: "bg-[#C8E5FF] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  terminated: "bg-[#FFD1C4] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  pending: "bg-[#FFF1B8] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",

  // Approval statuses
  pending_approval: "bg-[#FFF1B8] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  revision_requested: "bg-[#FFF1B8] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  approved: "bg-[#C2EED8] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  rejected: "bg-[#FFD1C4] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",

  // Issue statuses — consistent hues with issueStatusIcon above
  backlog: "bg-[#FFF8E8] text-[#5a525e] border-[1.5px] border-[#0d0c10]",
  todo: "bg-[#C8E5FF] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  in_progress: "bg-[#FFF1B8] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  in_review: "bg-[#DDD2FF] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  blocked: "bg-[#FFD1C4] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  done: "bg-[#C2EED8] text-[#0d0c10] border-[1.5px] border-[#0d0c10]",
  cancelled: "bg-[#FFF8E8] text-[#5a525e] border-[1.5px] border-[#0d0c10]",
};

export const statusBadgeDefault = "bg-[#FFF8E8] text-[#5a525e] border-[1.5px] border-[#0d0c10]";

// ---------------------------------------------------------------------------
// Agent status dot — solid background for small indicator dots
// ---------------------------------------------------------------------------

export const agentStatusDot: Record<string, string> = {
  running: "bg-[#1FA7FF] stack-pulse",
  active: "bg-[#27D17F]",
  paused: "bg-[#FF8A1A]",
  idle: "bg-[#FFC83A]",
  pending_approval: "bg-[#FFB400]",
  error: "bg-[#FF4D2E]",
  archived: "bg-[#5a525e]",
};

export const agentStatusDotDefault = "bg-[#5a525e]";

// ---------------------------------------------------------------------------
// Priority colors
// ---------------------------------------------------------------------------

export const priorityColor: Record<string, string> = {
  critical: "text-[#FF4D2E]",
  high: "text-[#FF8A1A]",
  medium: "text-[#FFC83A]",
  low: "text-[#1FA7FF]",
};

export const priorityColorDefault = "text-[#FFC83A]";
