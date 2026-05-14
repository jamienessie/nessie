import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { execute } from "./index.js";
import type { AdapterExecutionContext } from "@nessie/adapter-utils";

function makeCtx(adapterConfig: Record<string, unknown>): AdapterExecutionContext {
  return {
    runId: "run-1",
    agent: {
      id: "agent-1",
      companyId: "co-1",
      name: "test agent",
      adapterConfig,
    } as AdapterExecutionContext["agent"],
    runtime: {} as AdapterExecutionContext["runtime"],
    context: {} as AdapterExecutionContext["context"],
    onLog: vi.fn(async () => undefined),
    onProgress: vi.fn(async () => undefined),
  } as unknown as AdapterExecutionContext;
}

const FETCH_OK_BODY = JSON.stringify({ summary: "ok", outputText: "done" });
function makeFetchResponse() {
  return new Response(FETCH_OK_BODY, { status: 200, headers: { "content-type": "application/json" } });
}

describe("http-webhook execute() proxy routing", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(makeFetchResponse());
  });
  afterEach(() => {
    fetchSpy.mockRestore();
    delete process.env.NESSIE_PROXY_URL;
  });

  it("routes through NESSIE_PROXY_URL when env var is set", async () => {
    process.env.NESSIE_PROXY_URL = "http://proxy.example:9999/v1";
    await execute(makeCtx({ url: "https://upstream.example/hook" }));
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("http://proxy.example:9999/v1/webhook");
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers["x-nessie-upstream-url"]).toBe("https://upstream.example/hook");
  });

  it("falls back to default proxy 127.0.0.1:7777 when env unset", async () => {
    await execute(makeCtx({ url: "https://upstream.example/hook" }));
    const [calledUrl] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("http://127.0.0.1:7777/v1/webhook");
  });

  it("calls upstream directly when routeThroughProxy=false", async () => {
    await execute(makeCtx({ url: "https://upstream.example/hook", routeThroughProxy: false }));
    const [calledUrl, init] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("https://upstream.example/hook");
    const headers = (init as { headers: Record<string, string> }).headers;
    expect(headers["x-nessie-upstream-url"]).toBeUndefined();
  });

  it("forwards bearer as x-nessie-upstream-authorization through proxy", async () => {
    await execute(
      makeCtx({ url: "https://upstream.example/hook", bearerToken: "sk-live" }),
    );
    const init = fetchSpy.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers["x-nessie-upstream-authorization"]).toBe("Bearer sk-live");
    expect(init.headers["authorization"]).toBeUndefined();
  });

  it("keeps bearer on Authorization when bypassing the proxy", async () => {
    await execute(
      makeCtx({ url: "https://upstream.example/hook", bearerToken: "sk-live", routeThroughProxy: false }),
    );
    const init = fetchSpy.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers["authorization"]).toBe("Bearer sk-live");
    expect(init.headers["x-nessie-upstream-authorization"]).toBeUndefined();
  });

  it("respects an explicit config.proxyUrl override", async () => {
    await execute(
      makeCtx({ url: "https://upstream.example/hook", proxyUrl: "http://other-proxy:1234/v1/" }),
    );
    const [calledUrl] = fetchSpy.mock.calls[0];
    expect(calledUrl).toBe("http://other-proxy:1234/v1/webhook");
  });

  it("returns missing_url failure when no url is set", async () => {
    const result = await execute(makeCtx({}));
    expect(result.exitCode).toBe(1);
    expect(result.errorCode).toBe("missing_url");
  });
});
