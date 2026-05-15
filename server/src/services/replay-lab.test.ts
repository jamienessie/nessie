import { describe, expect, it, vi } from "vitest";
import { replayLabService } from "./replay-lab.js";
import type { Db } from "@nessie/db";

vi.mock("./activity-log.js", () => ({
  logActivity: vi.fn(async () => {}),
  publishPluginDomainEvent: vi.fn(),
}));

function makeStubDb() {
  let inserted: Record<string, unknown> = {};
  let updated: Record<string, unknown> = {};
  const stub = {
    insert: vi.fn(() => ({
      values: (vals: Record<string, unknown>) => ({
        returning: async () => {
          inserted = { id: "replay-1", createdAt: new Date(), ...vals };
          return [inserted];
        },
      }),
    })),
    update: vi.fn(() => ({
      set: (vals: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => {
            updated = {
              ...inserted,
              ...vals,
              completedAt: vals.completedAt ?? null,
            };
            return [updated];
          },
        }),
      }),
    })),
  } as unknown as Db;
  return { db: stub, getInserted: () => inserted, getUpdated: () => updated };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("replayLabService.replay", () => {
  it("captures a successful proxy reply with tokens + cost + latency", async () => {
    const { db, getUpdated } = makeStubDb();
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        choices: [{ message: { content: "the answer" } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }),
    ) as unknown as typeof fetch;
    const svc = replayLabService(db);
    const replay = await svc.replay({
      companyId: "co",
      overrideModel: "t3:llama-3.1-70b",
      overridePrompt: "hello",
      fetchImpl,
    });
    expect(replay.status).toBe("completed");
    expect(replay.outputText).toBe("the answer");
    expect(replay.inputTokens).toBe(100);
    expect(replay.outputTokens).toBe(50);
    expect(replay.latencyMs).toBeGreaterThanOrEqual(0);
    expect(getUpdated().status).toBe("completed");
  });

  it("captures HTTP failure with errorCode http_*", async () => {
    const { db } = makeStubDb();
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch;
    const svc = replayLabService(db);
    const replay = await svc.replay({
      companyId: "co",
      overrideModel: "t3:llama-3.1-70b",
      overridePrompt: "hello",
      fetchImpl,
    });
    expect(replay.status).toBe("failed");
    expect(replay.errorCode).toBe("http_503");
  });

  it("captures transport failure with errorCode transport_error", async () => {
    const { db } = makeStubDb();
    const fetchImpl = vi.fn(async () => {
      throw new Error("connection refused");
    }) as unknown as typeof fetch;
    const svc = replayLabService(db);
    const replay = await svc.replay({
      companyId: "co",
      overrideModel: "t3:llama-3.1-70b",
      overridePrompt: "hello",
      fetchImpl,
    });
    expect(replay.status).toBe("failed");
    expect(replay.errorCode).toBe("transport_error");
    expect(replay.errorMessage).toMatch(/connection refused/);
  });

  it("rejects empty prompt", async () => {
    const { db } = makeStubDb();
    const svc = replayLabService(db);
    await expect(
      svc.replay({ companyId: "co", overrideModel: "t3:x", overridePrompt: "   " }),
    ).rejects.toThrow();
  });
});
