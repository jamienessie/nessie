import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { arenaApi } from "./arena";

let fetchMock: ReturnType<typeof vi.fn>;
const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  fetchMock = vi.fn(async () => jsonResponse({ run: null, runs: [], entries: [] }));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("arenaApi", () => {
  it("create POSTs to /api/arena/runs with the full input body", async () => {
    await arenaApi.create({
      companyId: "co-1",
      taskType: "summarize",
      prompt: "hi",
      candidateModels: ["t2:gpt-4o-mini", "t3:llama-3.1-70b"],
      judgeModel: "t2:gpt-4o",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/arena/runs");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      companyId: "co-1",
      taskType: "summarize",
      prompt: "hi",
      candidateModels: ["t2:gpt-4o-mini", "t3:llama-3.1-70b"],
      judgeModel: "t2:gpt-4o",
    });
  });

  it("list GETs /api/arena/runs with filter querystring", async () => {
    await arenaApi.list("co-1", { taskType: "summarize", status: "judged", limit: 20 });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/api/arena/runs?");
    expect(url).toContain("companyId=co-1");
    expect(url).toContain("taskType=summarize");
    expect(url).toContain("status=judged");
    expect(url).toContain("limit=20");
  });

  it("get GETs /api/arena/runs/:id?companyId=", async () => {
    await arenaApi.get("run-1", "co-1");
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toBe("/api/arena/runs/run-1?companyId=co-1");
  });

  it("cancel POSTs to /api/arena/runs/:id/cancel", async () => {
    await arenaApi.cancel("run-1", "co-1");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/arena/runs/run-1/cancel?companyId=co-1");
    expect(init.method).toBe("POST");
  });

  it("leaderboard GETs /api/arena/leaderboard with optional taskType", async () => {
    await arenaApi.leaderboard("co-1", { taskType: "summarize" });
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/api/arena/leaderboard?");
    expect(url).toContain("companyId=co-1");
    expect(url).toContain("taskType=summarize");
  });
});
