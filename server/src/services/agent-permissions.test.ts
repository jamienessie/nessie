import { describe, expect, it } from "vitest";
import {
  canSendBusKindAtLevel,
  defaultPermissionsForRole,
  normalizeAgentPermissions,
  requiresOperatorApproval,
} from "./agent-permissions.js";

describe("canSendBusKindAtLevel", () => {
  it("allows communication-only kinds at L0", () => {
    expect(canSendBusKindAtLevel("clarification_request", 0)).toBe(true);
    expect(canSendBusKindAtLevel("evidence_request", 0)).toBe(true);
    expect(canSendBusKindAtLevel("review_request", 0)).toBe(true);
    expect(canSendBusKindAtLevel("operator_approval_request", 0)).toBe(true);
  });

  it("blocks hiring_request at L1 and allows at L2", () => {
    expect(canSendBusKindAtLevel("hiring_request", 1)).toBe(false);
    expect(canSendBusKindAtLevel("hiring_request", 2)).toBe(true);
  });

  it("blocks budget_request at L0 and allows at L1+", () => {
    expect(canSendBusKindAtLevel("budget_request", 0)).toBe(false);
    expect(canSendBusKindAtLevel("budget_request", 1)).toBe(true);
  });

  it("rejects unknown kinds at any level", () => {
    expect(canSendBusKindAtLevel("totally_unknown_kind", 5)).toBe(false);
  });
});

describe("requiresOperatorApproval", () => {
  it("always requires approval for operator_approval_request", () => {
    for (const level of [0, 1, 2, 3, 4, 5]) {
      expect(requiresOperatorApproval("operator_approval_request", level)).toBe(true);
    }
  });

  it("requires approval for hiring_request below L3 and not at L3+", () => {
    expect(requiresOperatorApproval("hiring_request", 2)).toBe(true);
    expect(requiresOperatorApproval("hiring_request", 3)).toBe(false);
    expect(requiresOperatorApproval("hiring_request", 4)).toBe(false);
  });

  it("requires approval for budget_request below L4 and not at L4+", () => {
    expect(requiresOperatorApproval("budget_request", 3)).toBe(true);
    expect(requiresOperatorApproval("budget_request", 4)).toBe(false);
    expect(requiresOperatorApproval("budget_request", 5)).toBe(false);
  });

  it("does not gate communication-only kinds", () => {
    expect(requiresOperatorApproval("clarification_request", 0)).toBe(false);
    expect(requiresOperatorApproval("review_request", 1)).toBe(false);
  });
});

describe("defaultPermissionsForRole", () => {
  it("grants canCreateAgents only to ceo", () => {
    expect(defaultPermissionsForRole("ceo").canCreateAgents).toBe(true);
    expect(defaultPermissionsForRole("cto").canCreateAgents).toBe(false);
    expect(defaultPermissionsForRole("engineer").canCreateAgents).toBe(false);
  });
});

describe("normalizeAgentPermissions", () => {
  it("falls back to role defaults when input is not an object", () => {
    expect(normalizeAgentPermissions(null, "ceo")).toEqual({ canCreateAgents: true });
    expect(normalizeAgentPermissions("nope", "engineer")).toEqual({ canCreateAgents: false });
    expect(normalizeAgentPermissions([], "ceo")).toEqual({ canCreateAgents: true });
  });

  it("respects an explicit canCreateAgents override", () => {
    expect(normalizeAgentPermissions({ canCreateAgents: false }, "ceo")).toEqual({
      canCreateAgents: false,
    });
    expect(normalizeAgentPermissions({ canCreateAgents: true }, "engineer")).toEqual({
      canCreateAgents: true,
    });
  });

  it("ignores non-boolean override and uses role default", () => {
    expect(normalizeAgentPermissions({ canCreateAgents: "yes" as unknown }, "engineer")).toEqual({
      canCreateAgents: false,
    });
  });
});
