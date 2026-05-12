import type { Db } from "@nessie/db";
import { issues } from "@nessie/db";

// Meeting write policy.
//
// Per plan §13: a Meeting *proposes*; the operator *commits*. Outcomes of
// kind DECIDE, ACTION, and ISSUE require operator approval before their
// real-world effects fire (issue creation, decision-record commit, status
// changes). MEMORY outcomes also require approval — institutional memory
// is curated, not scraped (Principle 11).
//
// In v1 the only gate is a boolean column: meeting_outcomes.approved_by_
// operator. The Cockpit Meetings UI flips it via PATCH; the meeting
// service's applyOutcome() refuses to fire effects when approval is
// false.
//
// Phase 6 (Trust layer) will replace this stub with a richer Approval
// engine that ties into the Agent Bus message kind
// `operator_approval_request` and the Black Box recorder.

export type MeetingOutcomeKind = "DECIDE" | "ACTION" | "MEMORY" | "ISSUE";

export const OUTCOMES_REQUIRING_APPROVAL: ReadonlySet<MeetingOutcomeKind> = new Set([
  "DECIDE",
  "ACTION",
  "MEMORY",
  "ISSUE",
]);

export function outcomeRequiresApproval(kind: MeetingOutcomeKind): boolean {
  return OUTCOMES_REQUIRING_APPROVAL.has(kind);
}

export interface OutcomeApprovalState {
  approvedByOperator: boolean;
  approvedAt: Date | null;
  appliedAt: Date | null;
}

export function isOutcomeReadyToApply(
  kind: MeetingOutcomeKind,
  state: OutcomeApprovalState,
): boolean {
  if (state.appliedAt) return false; // already applied
  if (!outcomeRequiresApproval(kind)) return true; // free to apply
  return state.approvedByOperator;
}

export interface ApplyOutcomeContext {
  companyId: string;
  meetingId: string;
  outcomeId: string;
}

export interface ApplyOutcomeResult {
  applied: boolean;
  ref?: string;
  reason?: string;
}

function readString(payload: Record<string, unknown>, key: string): string | undefined {
  const v = payload[key];
  return typeof v === "string" && v.trim().length > 0 ? v : undefined;
}

function readPriority(payload: Record<string, unknown>): "low" | "medium" | "high" | "urgent" {
  const v = payload.priority;
  return v === "low" || v === "medium" || v === "high" || v === "urgent" ? v : "medium";
}

// Apply the side effects of an approved outcome. DECIDE is recorded in
// place (the meeting_outcomes row itself IS the decision record — the
// caller stamps appliedAt). ACTION and ISSUE materialise a row in
// `issues`. MEMORY is a deliberate no-op until an institutional_memory
// table exists (TODO).
export async function applyOutcomeEffects(
  db: Db,
  outcome: { kind: MeetingOutcomeKind; payload: Record<string, unknown> },
  ctx: ApplyOutcomeContext,
): Promise<ApplyOutcomeResult> {
  switch (outcome.kind) {
    case "DECIDE": {
      // The meeting_outcomes row IS the decision record. Caller will
      // stamp appliedAt + merge appliedRef back into payload.
      return { applied: true, ref: ctx.outcomeId };
    }
    case "ACTION":
    case "ISSUE": {
      const title =
        readString(outcome.payload, "title") ??
        readString(outcome.payload, "summary") ??
        `Meeting ${outcome.kind.toLowerCase()}`;
      const description =
        readString(outcome.payload, "bodyMarkdown") ??
        readString(outcome.payload, "description") ??
        JSON.stringify(outcome.payload);
      const assigneeAgentId =
        outcome.kind === "ACTION" ? readString(outcome.payload, "ownerAgentId") : undefined;
      const [issueRow] = await db
        .insert(issues)
        .values({
          companyId: ctx.companyId,
          title,
          description,
          status: "backlog",
          priority: readPriority(outcome.payload),
          assigneeAgentId: assigneeAgentId ?? undefined,
          originKind: "meeting_outcome",
          originId: ctx.outcomeId,
        })
        .returning();
      if (!issueRow) {
        return { applied: false, reason: "issue_insert_returned_empty" };
      }
      return { applied: true, ref: issueRow.id };
    }
    case "MEMORY": {
      // TODO: promote into institutional memory once an
      // `institutional_memory` table exists. For now this returns
      // applied=true so the meeting can advance, but no row is written.
      return { applied: true };
    }
    default:
      return { applied: false, reason: "unknown_outcome_kind" };
  }
}
