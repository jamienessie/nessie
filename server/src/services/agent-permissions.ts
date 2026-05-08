// Phase 6 additions: autonomy levels L0..L5 enforced at the Agent Bus
// boundary. canSendBusKindAtLevel() and requiresOperatorApproval() let
// services/agent-bus.ts decide whether a message kind needs to be
// rewrapped into operator_approval_request before it reaches its
// recipient.
//
// L0 — observe only.
// L1 — suggest. Default for new hires. Communication-only kinds.
// L2 — create issues. Adds hiring_request, handoff, policy_check.
// L3 — execute low-risk on own issues with budgeted contracts.
// L4 — execute behind gates (overnight allowed).
// L5 — emergency operator-approved.

export const MIN_AUTONOMY_FOR_BUS_KIND: Record<string, number> = {
  clarification_request: 0,
  evidence_request: 0,
  review_request: 0,
  meeting_invite: 1,
  policy_check: 1,
  budget_request: 1,
  handoff: 1,
  hiring_request: 2,
  incident_escalation: 2,
  operator_approval_request: 0,
};

export function canSendBusKindAtLevel(kind: string, level: number): boolean {
  const min = MIN_AUTONOMY_FOR_BUS_KIND[kind];
  if (min === undefined) return false;
  return level >= min;
}

export function requiresOperatorApproval(kind: string, level: number): boolean {
  if (kind === "operator_approval_request") return true;
  if (kind === "hiring_request") return level < 3;
  if (kind === "budget_request") return level < 4;
  return false;
}

export type NormalizedAgentPermissions = Record<string, unknown> & {
  canCreateAgents: boolean;
};

export function defaultPermissionsForRole(role: string): NormalizedAgentPermissions {
  return {
    canCreateAgents: role === "ceo",
  };
}

export function normalizeAgentPermissions(
  permissions: unknown,
  role: string,
): NormalizedAgentPermissions {
  const defaults = defaultPermissionsForRole(role);
  if (typeof permissions !== "object" || permissions === null || Array.isArray(permissions)) {
    return defaults;
  }

  const record = permissions as Record<string, unknown>;
  return {
    canCreateAgents:
      typeof record.canCreateAgents === "boolean"
        ? record.canCreateAgents
        : defaults.canCreateAgents,
  };
}
