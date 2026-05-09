import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  discoverOpenRouterModels,
  listOpenRouterModels,
  parseOpenRouterModelsResponse,
  refreshOpenRouterModels,
  requireOpenRouterModelId,
  resetOpenRouterModelsCacheForTests,
  sortOpenRouterModels,
  testOpenRouterEnvironment,
} from "./index.js";

const originalEnv = {
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_BASE_URL: process.env.OPENROUTER_BASE_URL,
  OPENROUTER_HTTP_REFERER: process.env.OPENROUTER_HTTP_REFERER,
  OPENROUTER_X_TITLE: process.env.OPENROUTER_X_TITLE,
  OPENROUTER_TITLE: process.env.OPENROUTER_TITLE,
};

describe("openrouter model discovery", () => {
  beforeEach(() => {
    resetOpenRouterModelsCacheForTests();
    vi.restoreAllMocks();
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
  });

  it("sorts free models first and dedupes duplicate ids", () => {
    const sorted = sortOpenRouterModels([
      {
        model: { id: "openrouter/paid-z", label: "Paid Z" },
        free: false,
      },
      {
        model: { id: "openrouter/free-b", label: "Free B" },
        free: true,
      },
      {
        model: { id: "openrouter/free-a", label: "Free A" },
        free: true,
      },
    ]);

    expect(sorted.map((model) => model.id)).toEqual([
      "openrouter/free-a",
      "openrouter/free-b",
      "openrouter/paid-z",
    ]);
  });

  it("maps live OpenRouter metadata into runnable models and keeps free models at the top", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: [
        {
          id: "openrouter/paid",
          name: "Paid Model",
          pricing: { prompt: "0.00000075", completion: "0.0000015" },
        },
        {
          id: "openrouter/free-meta",
          name: "Free via pricing",
          pricing: { prompt: "0", completion: "0", request: "0" },
        },
        {
          id: "openrouter/suffix-free:free",
          name: "Free via suffix",
        },
        {
          id: "openrouter/paid",
          name: "Duplicate should be ignored",
          pricing: { prompt: "0.00000075", completion: "0.0000015" },
        },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch);

    const models = await listOpenRouterModels();

    expect(models.map((model) => model.id)).toEqual([
      "openrouter/free-meta",
      "openrouter/suffix-free:free",
      "openrouter/paid",
    ]);
    expect(models[0]?.label).toBe("Free via pricing");
    expect(models[1]?.label).toBe("Free via suffix");
  });

  it("surfaces a clear failure when the API key is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(listOpenRouterModels()).rejects.toThrow(
      "OpenRouter API key is missing",
    );
  });

  it("supports refreshes without using stale cache entries", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "openrouter/first", name: "First", pricing: { prompt: "0" } }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "openrouter/second", name: "Second", pricing: { prompt: "0" } }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const first = await listOpenRouterModels();
    const second = await refreshOpenRouterModels();

    expect(first.map((model) => model.id)).toEqual(["openrouter/first"]);
    expect(second.map((model) => model.id)).toEqual(["openrouter/second"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats execution environment checks as failures when the key is missing", async () => {
    delete process.env.OPENROUTER_API_KEY;
    const result = await testOpenRouterEnvironment({
      companyId: "company-1",
      adapterType: "openrouter_compatible",
      config: {},
    });

    expect(result.status).toBe("fail");
    expect(result.checks[0]?.code).toBe("openrouter_api_key_missing");
  });

  it("rejects blank OpenRouter model ids", () => {
    expect(() => requireOpenRouterModelId("")).toThrow(
      "OpenRouter adapter requires `model` on adapterConfig",
    );
  });
});

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = originalEnv.OPENROUTER_API_KEY;
  process.env.OPENROUTER_BASE_URL = originalEnv.OPENROUTER_BASE_URL;
  process.env.OPENROUTER_HTTP_REFERER = originalEnv.OPENROUTER_HTTP_REFERER;
  process.env.OPENROUTER_X_TITLE = originalEnv.OPENROUTER_X_TITLE;
  process.env.OPENROUTER_TITLE = originalEnv.OPENROUTER_TITLE;
});
