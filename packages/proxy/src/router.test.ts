import { describe, expect, it, vi } from "vitest";
import { pickProvider, resolveRequestedTier, stripTierPrefix } from "./router.js";
import type { CredentialView } from "./types.js";
import type { Db } from "@nessie/db";

vi.mock("./credentials.js", () => ({
  pickCredential: vi.fn(),
  resolveSecret: vi.fn(),
}));

import { pickCredential, resolveSecret } from "./credentials.js";

describe("resolveRequestedTier", () => {
  it("picks tier from X-Nessie-Tier header (case-insensitive)", () => {
    expect(resolveRequestedTier({ headerTier: "T1" })).toBe("T1");
    expect(resolveRequestedTier({ headerTier: "t2" })).toBe("T2");
    expect(resolveRequestedTier({ headerTier: "  t3  " })).toBe("T3");
  });

  it("picks tier from t1:/t2:/t3: model alias prefix", () => {
    expect(resolveRequestedTier({ modelAlias: "t1:claude-sonnet" })).toBe("T1");
    expect(resolveRequestedTier({ modelAlias: "t2:gpt-4o" })).toBe("T2");
    expect(resolveRequestedTier({ modelAlias: "t3:llama-3.1-70b" })).toBe("T3");
  });

  it("header wins over model alias", () => {
    expect(resolveRequestedTier({ headerTier: "T1", modelAlias: "t3:llama" })).toBe("T1");
  });

  it("defaults to T3 when nothing matches", () => {
    expect(resolveRequestedTier({})).toBe("T3");
    expect(resolveRequestedTier({ modelAlias: "gpt-4o" })).toBe("T3");
    expect(resolveRequestedTier({ headerTier: "garbage" })).toBe("T3");
  });
});

describe("stripTierPrefix", () => {
  it("removes t1:/t2:/t3: prefix", () => {
    expect(stripTierPrefix("t1:claude-sonnet")).toBe("claude-sonnet");
    expect(stripTierPrefix("T2:gpt-4o")).toBe("gpt-4o");
    expect(stripTierPrefix("t3:llama-3.1-70b")).toBe("llama-3.1-70b");
  });

  it("passes through bare model names", () => {
    expect(stripTierPrefix("gpt-4o")).toBe("gpt-4o");
    expect(stripTierPrefix("claude-sonnet")).toBe("claude-sonnet");
  });

  it("leaves non-tier prefixes alone", () => {
    expect(stripTierPrefix("ft:openai:abc")).toBe("ft:openai:abc");
  });
});

const fakeOpenAiCred: CredentialView = {
  id: "cred-1",
  tier: "T2",
  provider: "openai",
  displayName: "openai prod",
  secretRef: "OPENAI_API_KEY",
  status: "active",
  monthlyCapCents: null,
  monthlySpentCents: 0,
  dailyRequestCap: null,
  dailyRequestCount: 0,
  dailyResetAt: null,
  capabilities: [],
};

describe("pickProvider", () => {
  it("returns tos_blocked when T1 + Conservative + non-operator", async () => {
    const db = {} as Db;
    const result = await pickProvider(db, {
      tier: "T1",
      env: { NESSIE_TOS_AWARENESS: "Conservative" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("tos_blocked");
  });

  it("does not block T1 when operatorTriggered=true on Conservative", async () => {
    (pickCredential as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...fakeOpenAiCred,
      tier: "T1",
    });
    (resolveSecret as ReturnType<typeof vi.fn>).mockReturnValueOnce("sk-test");
    const result = await pickProvider({} as Db, {
      tier: "T1",
      operatorTriggered: true,
      env: { NESSIE_TOS_AWARENESS: "Conservative" },
    });
    expect(result.ok).toBe(true);
  });

  it("returns no_credential when pickCredential is null", async () => {
    (pickCredential as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const result = await pickProvider({} as Db, {
      tier: "T2",
      env: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_credential");
  });

  it("returns credential_no_secret when resolveSecret returns null", async () => {
    (pickCredential as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeOpenAiCred);
    (resolveSecret as ReturnType<typeof vi.fn>).mockReturnValueOnce(null);
    const result = await pickProvider({} as Db, {
      tier: "T2",
      env: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("credential_no_secret");
  });

  it("returns ok with the openai upstreamUrl when everything resolves", async () => {
    (pickCredential as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fakeOpenAiCred);
    (resolveSecret as ReturnType<typeof vi.fn>).mockReturnValueOnce("sk-test");
    const result = await pickProvider({} as Db, {
      tier: "T2",
      modelAlias: "t2:gpt-4o",
      env: {},
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.target.upstreamUrl).toBe("https://api.openai.com/v1");
      expect(result.target.upstreamModel).toBe("gpt-4o");
      expect(result.secret).toBe("sk-test");
    }
  });
});
