import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  createDb,
  companies,
  arenaRuns,
  arenaResults,
  activityLog,
} from "@nessie/db";
import { arenaService } from "../services/arena-service.ts";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

function openAiReply(text: string): string {
  return JSON.stringify({
    choices: [{ message: { content: text } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  });
}

function judgeReply(body: Record<string, unknown>): string {
  return openAiReply(JSON.stringify(body));
}

describeEmbeddedPostgres("arenaService", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("paperclip-arena-service-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(arenaResults);
    await db.delete(arenaRuns);
    await db.delete(activityLog);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedCompany(overrides: Partial<typeof companies.$inferInsert> = {}) {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Arena Co",
      issuePrefix: `A${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
      ...overrides,
    });
    return companyId;
  }

  it("creates a run with one result row per candidate and fans out via fetch", async () => {
    const companyId = await seedCompany();
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string) as { model: string };
      return new Response(openAiReply(`output for ${body.model}`), { status: 200 });
    }) as unknown as typeof fetch;
    const judgeImpl = vi.fn(async () => ({
      ok: true as const,
      rankings: [
        { model: "t2:gpt-4o-mini", score: 80, reasoning: "good" },
        { model: "t3:llama-3.1-70b", score: 65, reasoning: "okay" },
      ],
      winnerModel: "t2:gpt-4o-mini",
      notes: "winner concise",
      rubric: { correctness: 0.5 },
      judgeCostCents: 3,
      rawResponse: "",
    }));
    const svc = arenaService(db, { fetchImpl, judgeImpl });
    const created = await svc.create({
      companyId,
      taskType: "summarize",
      prompt: "Summarize",
      candidateModels: ["t2:gpt-4o-mini", "t3:llama-3.1-70b"],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const rt = (await import("../services/arena-service.ts")).__arenaRuntimeForTests.get(created.runId);
    await rt?.donePromise;

    const run = await svc.get(created.runId, companyId);
    expect(run).not.toBeNull();
    expect(run!.status).toBe("judged");
    expect(run!.winnerModel).toBe("t2:gpt-4o-mini");
    expect(run!.results).toHaveLength(2);
    const top = run!.results.find((r) => r.model === "t2:gpt-4o-mini")!;
    expect(top.status).toBe("completed");
    expect(top.outputText).toContain("t2:gpt-4o-mini");
    expect(top.score).toBe(80);
    // Each candidate sent a fetch.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(judgeImpl).toHaveBeenCalledTimes(1);
  });

  it("flips to failed when every candidate errors", async () => {
    const companyId = await seedCompany();
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    const judgeImpl = vi.fn();
    const svc = arenaService(db, { fetchImpl, judgeImpl });
    const created = await svc.create({
      companyId,
      taskType: "summarize",
      prompt: "Summarize",
      candidateModels: ["t2:gpt-4o-mini", "t3:llama-3.1-70b"],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const rt = (await import("../services/arena-service.ts")).__arenaRuntimeForTests.get(created.runId);
    await rt?.donePromise;

    const run = await svc.get(created.runId, companyId);
    expect(run!.status).toBe("failed");
    expect(run!.judgeError).toMatch(/all candidates failed/);
    expect(judgeImpl).not.toHaveBeenCalled();
    expect(run!.results.every((r) => r.status === "failed")).toBe(true);
  });

  it("flips to failed when judge fails after retries", async () => {
    const companyId = await seedCompany();
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string) as { model: string };
      return new Response(openAiReply(`output for ${body.model}`), { status: 200 });
    }) as unknown as typeof fetch;
    const judgeImpl = vi.fn(async () => ({
      ok: false as const,
      error: "judge failed after 3 attempts: response was not valid JSON",
      lastRawResponse: "not json",
      judgeCostCents: 1,
    }));
    const svc = arenaService(db, { fetchImpl, judgeImpl });
    const created = await svc.create({
      companyId,
      taskType: "summarize",
      prompt: "p",
      candidateModels: ["t2:gpt-4o-mini", "t3:llama-3.1-70b"],
    });
    if (!created.ok) throw new Error("create failed");
    const rt = (await import("../services/arena-service.ts")).__arenaRuntimeForTests.get(created.runId);
    await rt?.donePromise;
    const run = await svc.get(created.runId, companyId);
    expect(run!.status).toBe("failed");
    expect(run!.judgeError).toMatch(/judge failed/);
  });

  it("rejects unsupported candidate models", async () => {
    const companyId = await seedCompany();
    const svc = arenaService(db, { fetchImpl: vi.fn() as unknown as typeof fetch });
    const result = await svc.create({
      companyId,
      taskType: "summarize",
      prompt: "p",
      candidateModels: ["t2:gpt-4o-mini", "t9:nonexistent"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/not in the supported set/);
  });

  it("rejects fewer than 2 candidates", async () => {
    const companyId = await seedCompany();
    const svc = arenaService(db, { fetchImpl: vi.fn() as unknown as typeof fetch });
    const result = await svc.create({
      companyId,
      taskType: "summarize",
      prompt: "p",
      candidateModels: ["t2:gpt-4o-mini"],
    });
    expect(result.ok).toBe(false);
  });

  it("refuses to start when company is paused for budget", async () => {
    const companyId = await seedCompany({ status: "paused", pauseReason: "budget" });
    const svc = arenaService(db, { fetchImpl: vi.fn() as unknown as typeof fetch });
    const result = await svc.create({
      companyId,
      taskType: "summarize",
      prompt: "p",
      candidateModels: ["t2:gpt-4o-mini", "t3:llama-3.1-70b"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/budget hard-stop/);
  });

  it("cancel flips pending rows + run to cancelled and aborts fetches", async () => {
    const companyId = await seedCompany();
    let cancelObserved = false;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      // Block until cancelled. Resolve as aborted.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          cancelObserved = true;
          const err = new Error("aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as unknown as typeof fetch;
    const judgeImpl = vi.fn();
    const svc = arenaService(db, { fetchImpl, judgeImpl });
    const created = await svc.create({
      companyId,
      taskType: "summarize",
      prompt: "p",
      candidateModels: ["t2:gpt-4o-mini", "t3:llama-3.1-70b"],
    });
    if (!created.ok) throw new Error("create failed");
    // Cancel almost immediately.
    await new Promise((r) => setTimeout(r, 10));
    const cancel = await svc.cancel(created.runId, { actorType: "user", actorId: "u" });
    expect(cancel.ok).toBe(true);
    const rt = (await import("../services/arena-service.ts")).__arenaRuntimeForTests.get(created.runId);
    await rt?.donePromise.catch(() => undefined);
    const run = await svc.get(created.runId, companyId);
    expect(run!.status).toBe("cancelled");
    expect(cancelObserved).toBe(true);
    expect(judgeImpl).not.toHaveBeenCalled();
  });

  it("leaderboard ranks by wins and avg score across judged runs", async () => {
    const companyId = await seedCompany();
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(init!.body as string) as { model: string };
      return new Response(openAiReply(`out:${body.model}`), { status: 200 });
    }) as unknown as typeof fetch;
    let winnerNext = "t2:gpt-4o-mini";
    const judgeImpl = vi.fn(async () => ({
      ok: true as const,
      rankings: [
        { model: "t2:gpt-4o-mini", score: 90, reasoning: "" },
        { model: "t3:llama-3.1-70b", score: 70, reasoning: "" },
      ],
      winnerModel: winnerNext,
      notes: "",
      rubric: {},
      judgeCostCents: 1,
      rawResponse: "",
    }));
    const svc = arenaService(db, { fetchImpl, judgeImpl });
    // 3 runs, t2 wins twice
    for (let i = 0; i < 3; i += 1) {
      winnerNext = i === 1 ? "t3:llama-3.1-70b" : "t2:gpt-4o-mini";
      const created = await svc.create({
        companyId,
        taskType: "summarize",
        prompt: `p${i}`,
        candidateModels: ["t2:gpt-4o-mini", "t3:llama-3.1-70b"],
      });
      if (!created.ok) throw new Error("create failed");
      const rt = (await import("../services/arena-service.ts")).__arenaRuntimeForTests.get(created.runId);
      await rt?.donePromise;
    }
    const board = await svc.leaderboard(companyId);
    expect(board[0].model).toBe("t2:gpt-4o-mini");
    expect(board[0].wins).toBe(2);
    expect(board.find((e) => e.model === "t3:llama-3.1-70b")!.wins).toBe(1);
  });
});
