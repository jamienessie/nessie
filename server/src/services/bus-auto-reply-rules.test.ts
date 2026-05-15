import { describe, expect, it, vi } from "vitest";
import { busAutoReplyRulesService } from "./bus-auto-reply-rules.js";
import type { Db } from "@nessie/db";

vi.mock("./activity-log.js", () => ({
  logActivity: vi.fn(async () => {}),
  publishPluginDomainEvent: vi.fn(),
}));

function makeStubDb(rows: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: () => ({
        where: () => ({
          orderBy: async () => rows,
        }),
      }),
    })),
  } as unknown as Db;
}

describe("busAutoReplyRulesService.evaluate", () => {
  it("returns null when no rules match", async () => {
    const svc = busAutoReplyRulesService(makeStubDb([]));
    const rule = await svc.evaluate("co", { kind: "clarification_request", fromAgentId: null, payload: {} });
    expect(rule).toBeNull();
  });

  it("matches by kind alone when fromAgentIds and payloadMatch are empty", async () => {
    const svc = busAutoReplyRulesService(
      makeStubDb([
        {
          id: "r1",
          companyId: "co",
          name: "any clarification",
          kind: "clarification_request",
          fromAgentIds: null,
          payloadMatch: null,
          action: "dismiss",
          replyTemplate: null,
          position: 0,
          enabled: "true",
          createdByUserId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    );
    const rule = await svc.evaluate("co", { kind: "clarification_request", fromAgentId: "a-1", payload: { foo: 1 } });
    expect(rule?.id).toBe("r1");
  });

  it("requires fromAgentId membership when fromAgentIds is set", async () => {
    const svc = busAutoReplyRulesService(
      makeStubDb([
        {
          id: "r1",
          companyId: "co",
          name: "from aria only",
          kind: "clarification_request",
          fromAgentIds: ["aria"],
          payloadMatch: null,
          action: "dismiss",
          replyTemplate: null,
          position: 0,
          enabled: "true",
          createdByUserId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    );
    const noMatch = await svc.evaluate("co", { kind: "clarification_request", fromAgentId: "marcus", payload: {} });
    expect(noMatch).toBeNull();
    const match = await svc.evaluate("co", { kind: "clarification_request", fromAgentId: "aria", payload: {} });
    expect(match?.id).toBe("r1");
  });

  it("requires every payloadMatch key to equal the message payload value", async () => {
    const svc = busAutoReplyRulesService(
      makeStubDb([
        {
          id: "r1",
          companyId: "co",
          name: "ux clarifications",
          kind: "clarification_request",
          fromAgentIds: null,
          payloadMatch: { label: "ux", priority: "low" },
          action: "auto_reply",
          replyTemplate: { ok: true },
          position: 0,
          enabled: "true",
          createdByUserId: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]),
    );
    const noMatch = await svc.evaluate("co", {
      kind: "clarification_request",
      fromAgentId: "aria",
      payload: { label: "ux", priority: "high" },
    });
    expect(noMatch).toBeNull();
    const match = await svc.evaluate("co", {
      kind: "clarification_request",
      fromAgentId: "aria",
      payload: { label: "ux", priority: "low", extra: "ignored" },
    });
    expect(match?.id).toBe("r1");
  });
});
