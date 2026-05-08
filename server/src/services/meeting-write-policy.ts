import type { Db } from "@nessie/db";

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

// Placeholder for the full apply path. Phase 5+ wires this to issue
// creation, document writes, memory promotion. For now it is a no-op
// that flips appliedAt.
export async function applyOutcomeEffects(
  _db: Db,
  outcome: { kind: MeetingOutcomeKind; payload: Record<string, unknown> },
): Promise<{ applied: boolean; ref?: string; reason?: string }> {
  switch (outcome.kind) {
    case "DECIDE":
      // Phase 6: write to a decision_records table; for now log only.
      return { applied: true };
    case "ACTION":
      // Phase 5: create an issue from payload; for now log only.
      return { applied: true };
    case "ISSUE":
      // Phase 5: create the proposed issue; for now log only.
      return { applied: true };
    case "MEMORY":
      // Phase 7: promote into institutional memory; for now log only.
      return { applied: true };
    default:
      return { applied: false, reason: "unknown_outcome_kind" };
  }
}
