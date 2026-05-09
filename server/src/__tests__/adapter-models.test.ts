import { beforeEach, describe, expect, it, vi } from "vitest";
import { listAdapterModels, refreshAdapterModels } from "../adapters/index.js";

const codexModelDiscovery = vi.hoisted(() => {
  const discovered = [
    { id: "gpt-5.5", label: "gpt-5.5" },
    { id: "gpt-5.4", label: "gpt-5.4" },
    { id: "gpt-5.4-mini", label: "gpt-5.4-mini" },
  ];
  const refreshed = [
    { id: "gpt-5.5", label: "gpt-5.5" },
    { id: "gpt-5.4-mini", label: "gpt-5.4-mini" },
  ];
  return {
    list: vi.fn(async () => discovered),
    refresh: vi.fn(async () => refreshed),
    reset: vi.fn(),
    discovered,
    refreshed,
  };
});

vi.mock("../adapters/codex-models.js", () => ({
  listCodexModels: codexModelDiscovery.list,
  refreshCodexModels: codexModelDiscovery.refresh,
  resetCodexModelsCacheForTests: codexModelDiscovery.reset,
}));

describe("adapter model listing", () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
    codexModelDiscovery.list.mockClear();
    codexModelDiscovery.refresh.mockClear();
    codexModelDiscovery.reset.mockClear();
    vi.clearAllMocks();
  });

  it("returns an empty list for unknown adapters", async () => {
    const models = await listAdapterModels("unknown_adapter");
    expect(models).toEqual([]);
  });

  it("returns discovered codex models from the live discovery path", async () => {
    const models = await listAdapterModels("codex_local");

    expect(codexModelDiscovery.list).toHaveBeenCalledTimes(1);
    expect(models).toEqual(codexModelDiscovery.discovered);
    expect(models.some((model) => model.id === "gpt-5.4-mini")).toBe(true);
    expect(models.some((model) => model.id === "gpt-5.3-codex-spark")).toBe(false);
  });

  it("refreshes codex models on demand", async () => {
    const initial = await listAdapterModels("codex_local");
    const refreshed = await refreshAdapterModels("codex_local");

    expect(codexModelDiscovery.list).toHaveBeenCalledTimes(1);
    expect(codexModelDiscovery.refresh).toHaveBeenCalledTimes(1);
    expect(initial).toEqual(codexModelDiscovery.discovered);
    expect(refreshed).toEqual(codexModelDiscovery.refreshed);
  });

  it("surfaces live codex discovery failures instead of falling back to static models", async () => {
    codexModelDiscovery.list.mockRejectedValueOnce(new Error("Codex app-server unavailable"));

    await expect(listAdapterModels("codex_local")).rejects.toThrow(
      "Codex app-server unavailable",
    );
  });
});
