import { Link } from "@/lib/router";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { deriveInitials } from "./Identity";
import { IssueReferenceActivitySummary } from "./IssueReferenceActivitySummary";
import { timeAgo } from "../lib/timeAgo";
import { cn } from "../lib/utils";
import { formatActivityVerb } from "../lib/activity-format";
import { deriveProjectUrlKey, type ActivityEvent, type Agent } from "@nessie/shared";
import type { CompanyUserProfile } from "../lib/company-members";

/**
 * The Newsroom ticker renders activity events as Bloomberg-style headlines:
 * a category badge, the headline text, a severity flag for high-impact
 * events, and a relative timestamp. The headlines are categorised purely from
 * the action prefix — no server changes required.
 */

type NewsCategory =
  | "ENGINEERING"
  | "PEOPLE"
  | "STRATEGY"
  | "FINANCE"
  | "GOVERNANCE"
  | "OPERATIONS"
  | "SYSTEM";

interface NewsStyling {
  category: NewsCategory;
  accent: string;
  isBreaking: boolean;
}

/**
 * Map an action string (e.g. "issue.created", "approval.approved",
 * "budget_hard_threshold_crossed") to a newsroom category + accent colour.
 * Budget/governance events get a "BREAKING" flag.
 */
function classifyAction(action: string): NewsStyling {
  const a = action.toLowerCase();

  if (a.startsWith("budget") || a.includes("budget")) {
    return { category: "FINANCE", accent: "#FF4D2E", isBreaking: a.includes("hard") || a.includes("incident") };
  }
  if (a.startsWith("approval")) {
    return { category: "GOVERNANCE", accent: "#FFC83A", isBreaking: a.includes("rejected") };
  }
  if (a.startsWith("agent.") || a.startsWith("hire") || a.startsWith("candidate")) {
    return { category: "PEOPLE", accent: "#A4D81F", isBreaking: a.includes("terminated") || a.includes("paused") };
  }
  if (a.startsWith("goal")) {
    return { category: "STRATEGY", accent: "#FFD2EA", isBreaking: false };
  }
  if (a.startsWith("cost") || a.startsWith("finance")) {
    return { category: "FINANCE", accent: "#FFE0BB", isBreaking: false };
  }
  if (a.startsWith("company.")) {
    return { category: "OPERATIONS", accent: "#C8E5FF", isBreaking: false };
  }
  if (a.startsWith("issue") || a.startsWith("heartbeat") || a.startsWith("project")) {
    return { category: "ENGINEERING", accent: "#27D17F", isBreaking: false };
  }
  return { category: "SYSTEM", accent: "#C2EED8", isBreaking: false };
}

function entityLink(entityType: string, entityId: string, name?: string | null): string | null {
  switch (entityType) {
    case "issue": return `/issues/${name ?? entityId}`;
    case "agent": return `/agents/${entityId}`;
    case "project": return `/projects/${deriveProjectUrlKey(name, entityId)}`;
    case "goal": return `/goals/${entityId}`;
    case "approval": return `/approvals/${entityId}`;
    default: return null;
  }
}

interface NewsTickerProps {
  event: ActivityEvent;
  agentMap: Map<string, Agent>;
  userProfileMap?: Map<string, CompanyUserProfile>;
  entityNameMap: Map<string, string>;
  entityTitleMap?: Map<string, string>;
  className?: string;
}

export function NewsTicker({
  event,
  agentMap,
  userProfileMap,
  entityNameMap,
  entityTitleMap,
  className,
}: NewsTickerProps) {
  const verb = formatActivityVerb(event.action, event.details, { agentMap, userProfileMap });
  const styling = classifyAction(event.action);

  const isHeartbeatEvent = event.entityType === "heartbeat_run";
  const heartbeatAgentId = isHeartbeatEvent
    ? (event.details as Record<string, unknown> | null)?.agentId as string | undefined
    : undefined;

  const name = isHeartbeatEvent
    ? (heartbeatAgentId ? entityNameMap.get(`agent:${heartbeatAgentId}`) : null)
    : entityNameMap.get(`${event.entityType}:${event.entityId}`);

  const entityTitle = entityTitleMap?.get(`${event.entityType}:${event.entityId}`);

  const link = isHeartbeatEvent && heartbeatAgentId
    ? `/agents/${heartbeatAgentId}/runs/${event.entityId}`
    : entityLink(event.entityType, event.entityId, name);

  const actor = event.actorType === "agent" ? agentMap.get(event.actorId) : null;
  const userProfile = event.actorType === "user" ? userProfileMap?.get(event.actorId) : null;
  const actorName =
    actor?.name ??
    (event.actorType === "system"
      ? "System"
      : userProfile?.label ?? (event.actorType === "user" ? "Board" : event.actorId || "Unknown"));
  const actorAvatarUrl = userProfile?.image ?? null;

  const inner = (
    <div className="flex items-start gap-3">
      {/* Category bar */}
      <span
        className="mt-1 inline-flex items-center justify-center rounded-sm px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-[#0d0c10] shrink-0"
        style={{ background: styling.accent }}
        aria-label={`Category: ${styling.category}`}
      >
        {styling.category}
      </span>

      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <Avatar size="xs">
            {actorAvatarUrl && <AvatarImage src={actorAvatarUrl} alt={actorName} />}
            <AvatarFallback>{deriveInitials(actorName)}</AvatarFallback>
          </Avatar>
          <p className="min-w-0 flex-1 truncate text-[#0d0c10] font-semibold">
            <span>{actorName}</span>
            <span className="text-[#5a525e]"> {verb} </span>
            {name && <span className="font-bold">{name}</span>}
            {entityTitle && <span className="text-[#5a525e]"> — {entityTitle}</span>}
          </p>
          {styling.isBreaking && (
            <span
              className="rounded-sm bg-[#FF4D2E] px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-white shrink-0"
              aria-label="Breaking news"
            >
              BREAKING
            </span>
          )}
          <span className="text-[10px] font-mono font-bold uppercase text-[#5a525e] shrink-0">
            {timeAgo(event.createdAt)}
          </span>
        </div>
        <IssueReferenceActivitySummary event={event} />
      </div>
    </div>
  );

  const classes = cn(
    "px-4 py-3 text-sm",
    link && "cursor-pointer hover:bg-[#FFF1B8]/40 transition-colors",
    className,
  );

  if (link) {
    return (
      <Link to={link} className={cn(classes, "no-underline text-inherit block")}>
        {inner}
      </Link>
    );
  }

  return <div className={classes}>{inner}</div>;
}
