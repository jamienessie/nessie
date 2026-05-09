import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAzureChatCompletionsUrl,
  isReasoningDeployment,
  listAzureOpenaiModels,
  parseAzureDeploymentsResponse,
  readApiVersionFromConfigOrEnv,
  refreshAzureOpenaiModels,
  requireAzureDeploymentId,
  resetAzureOpenaiModelsCacheForTests,
  sortAzureDeployments,
  testAzureOpenaiEnvironment,
} from "./index.js";

const originalEnv = {
  AZURE_OPENAI_API_KEY: process.env.AZURE_OPENAI_API_KEY,
  AZURE_OPENAI_ENDPOINT: process.env.AZURE_OPENAI_ENDPOINT,
  AZURE_OPENAI_API_VERSION: process.env.AZURE_OPENAI_API_VERSION,
};

describe("azure_openai deployment discovery", () => {
  beforeEach(() => {
    resetAzureOpenaiModelsCacheForTests();
    vi.restoreAllMocks();
    process.env.AZURE_OPENAI_API_KEY = "test-azure-key";
    process.env.AZURE_OPENAI_ENDPOINT = "https://nessie-test.openai.azure.com";
    delete process.env.AZURE_OPENAI_API_VERSION;
  });

  it("sorts deployments alphabetically and dedupes duplicate ids", () => {
    const sorted = sortAzureDeployments([
      { id: "gpt-4o", label: "gpt-4o (gpt-4o)" },
      { id: "gpt-4o-mini", label: "gpt-4o-mini (gpt-4o-mini)" },
      { id: "amber", label: "amber" },
    ]);

    expect(sorted.map((m) => m.id)).toEqual(["amber", "gpt-4o", "gpt-4o-mini"]);
  });

  it("parses Azure deployments response and dedupes duplicate ids", () => {
    const parsed = parseAzureDeploymentsResponse({
      data: [
        { id: "gpt-4o", model: "gpt-4o" },
        { id: "gpt-4o-mini", model: "gpt-4o-mini" },
        { id: "gpt-4o", model: "gpt-4o" },
      ],
    });

    expect(parsed.map((m) => m.id)).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(parsed[0]?.label).toBe("gpt-4o");
  });

  it("reads model name from nested properties.model.name when top-level model is absent", () => {
    const parsed = parseAzureDeploymentsResponse({
      data: [
        {
          id: "my-deployment",
          properties: { model: { name: "gpt-4o-2024-08-06" } },
        },
      ],
    });

    expect(parsed).toEqual([
      { id: "my-deployment", label: "my-deployment (gpt-4o-2024-08-06)" },
    ]);
  });

  it("falls back to deployment id label when no model name is available", () => {
    const parsed = parseAzureDeploymentsResponse({
      data: [{ id: "bare" }],
    });

    expect(parsed).toEqual([{ id: "bare", label: "bare" }]);
  });

  it("fetches Azure deployments via the discovery endpoint with api-key header", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      expect(url).toBe(
        "https://nessie-test.openai.azure.com/openai/deployments?api-version=2023-05-01",
      );
      return new Response(
        JSON.stringify({
          data: [
            { id: "gpt-4o", model: "gpt-4o" },
            { id: "gpt-4o-mini", model: "gpt-4o-mini" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const models = await listAzureOpenaiModels();

    expect(models.map((m) => m.id)).toEqual(["gpt-4o", "gpt-4o-mini"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const callArgs = fetchMock.mock.calls[0] as unknown[] | undefined;
    const callInit = callArgs?.[1] as RequestInit | undefined;
    expect((callInit?.headers as Record<string, string> | undefined)?.["api-key"]).toBe("test-azure-key");
  });

  it("surfaces a clear failure when the API key is missing", async () => {
    delete process.env.AZURE_OPENAI_API_KEY;
    await expect(listAzureOpenaiModels()).rejects.toThrow(
      "Azure OpenAI API key is missing",
    );
  });

  it("surfaces a clear failure when the endpoint is missing", async () => {
    delete process.env.AZURE_OPENAI_ENDPOINT;
    await expect(listAzureOpenaiModels()).rejects.toThrow(
      "Azure OpenAI endpoint is missing",
    );
  });

  it("supports refreshes without using stale cache entries", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "gpt-4o", model: "gpt-4o" }],
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: "gpt-4o-mini", model: "gpt-4o-mini" }],
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);

    const first = await listAzureOpenaiModels();
    const second = await refreshAzureOpenaiModels();

    expect(first.map((m) => m.id)).toEqual(["gpt-4o"]);
    expect(second.map((m) => m.id)).toEqual(["gpt-4o-mini"]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("treats environment checks as failures when the key is missing", async () => {
    delete process.env.AZURE_OPENAI_API_KEY;
    const result = await testAzureOpenaiEnvironment({
      companyId: "company-1",
      adapterType: "azure_openai",
      config: {},
    });

    expect(result.status).toBe("fail");
    expect(result.checks[0]?.code).toBe("azure_openai_api_key_missing");
  });

  it("treats environment checks as failures when the endpoint is missing", async () => {
    delete process.env.AZURE_OPENAI_ENDPOINT;
    const result = await testAzureOpenaiEnvironment({
      companyId: "company-1",
      adapterType: "azure_openai",
      config: {},
    });

    expect(result.status).toBe("fail");
    expect(result.checks[0]?.code).toBe("azure_openai_endpoint_missing");
  });

  it("returns an empty list when the deployments endpoint is 404 (resource doesn't expose listing)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", {
      status: 404,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch);

    const models = await listAzureOpenaiModels();
    expect(models).toEqual([]);
  });

  it("environment test warns with `azure_openai_listing_unsupported` on 404", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", {
      status: 404,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch);

    const result = await testAzureOpenaiEnvironment({
      companyId: "company-1",
      adapterType: "azure_openai",
      config: {},
    });

    expect(result.status).toBe("warn");
    expect(result.checks[0]?.code).toBe("azure_openai_listing_unsupported");
  });

  it("warns when reachable but no deployments are returned", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch);

    const result = await testAzureOpenaiEnvironment({
      companyId: "company-1",
      adapterType: "azure_openai",
      config: {},
    });

    expect(result.status).toBe("warn");
    expect(result.checks[0]?.code).toBe("azure_openai_no_deployments");
  });

  it("rejects blank deployment ids", () => {
    expect(() => requireAzureDeploymentId("")).toThrow(
      "Azure OpenAI adapter requires `deployment` on adapterConfig",
    );
  });

  it("builds the chat completions URL with deployment and api-version", () => {
    const url = buildAzureChatCompletionsUrl({
      endpoint: "https://nessie-test.openai.azure.com",
      deployment: "gpt-4o",
      apiVersion: "2024-10-21",
    });

    expect(url).toBe(
      "https://nessie-test.openai.azure.com/openai/deployments/gpt-4o/chat/completions?api-version=2024-10-21",
    );
  });

  it("defaults the api version when neither config nor env provides one", () => {
    expect(readApiVersionFromConfigOrEnv({})).toBe("2024-10-21");
  });

  it("respects api version from config over env", () => {
    process.env.AZURE_OPENAI_API_VERSION = "2024-02-01";
    expect(readApiVersionFromConfigOrEnv({ apiVersion: "2024-08-01-preview" })).toBe(
      "2024-08-01-preview",
    );
  });

  it("recognises o-series deployment names as reasoning models", () => {
    expect(isReasoningDeployment("o1")).toBe(true);
    expect(isReasoningDeployment("o1-mini")).toBe(true);
    expect(isReasoningDeployment("o3-mini")).toBe(true);
    expect(isReasoningDeployment("o4-mini")).toBe(true);
    expect(isReasoningDeployment("O4-MINI")).toBe(true);
  });

  it("does not treat gpt deployments as reasoning models", () => {
    expect(isReasoningDeployment("gpt-4o")).toBe(false);
    expect(isReasoningDeployment("gpt-4o-mini")).toBe(false);
    expect(isReasoningDeployment("gpt-4.1")).toBe(false);
    expect(isReasoningDeployment("orion")).toBe(false);
  });
});

beforeEach(() => {
  process.env.AZURE_OPENAI_API_KEY = originalEnv.AZURE_OPENAI_API_KEY;
  process.env.AZURE_OPENAI_ENDPOINT = originalEnv.AZURE_OPENAI_ENDPOINT;
  process.env.AZURE_OPENAI_API_VERSION = originalEnv.AZURE_OPENAI_API_VERSION;
});
