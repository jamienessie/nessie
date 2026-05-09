import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { execute } from "./execute.js";

const originalEnv = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
};

describe("openrouter execute", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
  });

  afterEach(() => {
    if (originalEnv.OPENROUTER_API_KEY === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalEnv.OPENROUTER_API_KEY;
    }
    if (originalEnv.OPENROUTER_BASE_URL === undefined) {
      delete process.env.OPENROUTER_BASE_URL;
    } else {
      process.env.OPENROUTER_BASE_URL = originalEnv.OPENROUTER_BASE_URL;
    }
  });

  it("uses adapterConfig.env.OPENROUTER_API_KEY when present", async () => {
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_url)).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(init?.headers).toMatchObject({
        Authorization: "Bearer config-key",
      });
      return new Response(JSON.stringify({
        id: "chatcmpl-123",
        choices: [{ message: { content: "hello" }, finish_reason: "stop" }],
        usage: {
          prompt_tokens: 3,
          completion_tokens: 1,
          cached_input_tokens: 0,
        },
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const result = await execute({
      runId: "run-123",
      agent: {
        id: "agent-1",
        companyId: "company-1",
        name: "OpenRouter Agent",
        role: "general",
        adapterType: "openrouter_compatible",
        adapterConfig: {
          model: "openai/gpt-5.2",
          env: {
            OPENROUTER_API_KEY: "config-key",
          },
        },
      },
      runtime: {},
      config: {},
      context: { prompt: "Say hello" },
      onLog: async () => {},
      onMeta: async () => {},
      onSpawn: async () => {},
    } as never);

    expect(result.exitCode).toBe(0);
    expect(result.provider).toBe("openrouter");
    expect(result.biller).toBe("openrouter");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
