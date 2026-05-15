import { describe, expect, it, vi } from "vitest";
import { pickCredential, resolveSecret } from "./credentials.js";
import type { CredentialView } from "./types.js";
import type { Db } from "@nessie/db";

type Row = {
  id: string;
  tier: string;
  provider: string;
  displayName: string;
  secretRef: string;
  status: string;
  monthlyCapCents: number | null;
  monthlySpentCents: number;
  dailyRequestCap?: number | null;
  dailyRequestCount?: number;
  dailyResetAt?: Date | null;
  capabilities: Record<string, unknown>;
};

function makeDbWithRows(rows: Row[]): Db {
  return {
    select: vi.fn(() => ({
      from: () => ({
        where: () => Promise.resolve(rows),
      }),
    })),
  } as unknown as Db;
}

const baseRow: Row = {
  id: "cred-1",
  tier: "T2",
  provider: "openai",
  displayName: "openai-1",
  secretRef: "OPENAI_API_KEY",
  status: "active",
  monthlyCapCents: null,
  monthlySpentCents: 0,
  dailyRequestCap: null,
  dailyRequestCount: 0,
  dailyResetAt: null,
  capabilities: {},
};

describe("pickCredential", () => {
  it("returns null when no credentials exist for tier", async () => {
    const db = makeDbWithRows([]);
    expect(await pickCredential(db, "T2")).toBeNull();
  });

  it("returns null when all credentials are exhausted", async () => {
    const db = makeDbWithRows([
      { ...baseRow, id: "a", monthlyCapCents: 1000, monthlySpentCents: 1000 },
      { ...baseRow, id: "b", monthlyCapCents: 500, monthlySpentCents: 600 },
    ]);
    expect(await pickCredential(db, "T2")).toBeNull();
  });

  it("tie-breaks by lowest monthlySpentCents", async () => {
    const db = makeDbWithRows([
      { ...baseRow, id: "high", monthlySpentCents: 800 },
      { ...baseRow, id: "low", monthlySpentCents: 100 },
      { ...baseRow, id: "mid", monthlySpentCents: 400 },
    ]);
    const picked = await pickCredential(db, "T2");
    expect(picked?.id).toBe("low");
  });

  it("treats null cap as unlimited and still picks the cheapest spent", async () => {
    const db = makeDbWithRows([
      { ...baseRow, id: "uncapped", monthlyCapCents: null, monthlySpentCents: 50 },
      { ...baseRow, id: "capped", monthlyCapCents: 10_000, monthlySpentCents: 20 },
    ]);
    const picked = await pickCredential(db, "T2");
    expect(picked?.id).toBe("capped");
  });

  it("returns a normalized CredentialView shape", async () => {
    const db = makeDbWithRows([baseRow]);
    const picked = await pickCredential(db, "T2");
    expect(picked).toMatchObject<Partial<CredentialView>>({
      id: "cred-1",
      tier: "T2",
      provider: "openai",
      displayName: "openai-1",
      secretRef: "OPENAI_API_KEY",
      status: "active",
    });
  });

  it("Quota Watchdog: skips credentials at or above their daily request cap", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const db = makeDbWithRows([
      { ...baseRow, id: "capped", dailyRequestCap: 200, dailyRequestCount: 200, dailyResetAt: future, monthlySpentCents: 10 },
      { ...baseRow, id: "fresh", dailyRequestCap: 200, dailyRequestCount: 0, dailyResetAt: future, monthlySpentCents: 50 },
    ]);
    const picked = await pickCredential(db, "T2");
    expect(picked?.id).toBe("fresh");
  });

  it("Quota Watchdog: a credential past its daily reset window is treated as fresh", async () => {
    const past = new Date(Date.now() - 60 * 60 * 1000);
    const db = makeDbWithRows([
      { ...baseRow, id: "rolled", dailyRequestCap: 200, dailyRequestCount: 200, dailyResetAt: past, monthlySpentCents: 5 },
    ]);
    const picked = await pickCredential(db, "T2");
    expect(picked?.id).toBe("rolled");
  });

  it("Quota Watchdog: respects excludeCredentialIds for rotation", async () => {
    const db = makeDbWithRows([
      { ...baseRow, id: "first", monthlySpentCents: 0 },
      { ...baseRow, id: "second", monthlySpentCents: 100 },
    ]);
    const picked = await pickCredential(db, "T2", { excludeCredentialIds: ["first"] });
    expect(picked?.id).toBe("second");
  });
});

describe("resolveSecret", () => {
  const cred: CredentialView = {
    id: "cred-1",
    tier: "T2",
    provider: "openai",
    displayName: "x",
    secretRef: "MY_API_KEY",
    status: "active",
    monthlyCapCents: null,
    monthlySpentCents: 0,
    dailyRequestCap: null,
    dailyRequestCount: 0,
    dailyResetAt: null,
    capabilities: [],
  };

  it("returns the env var value when set", () => {
    expect(resolveSecret(cred, { MY_API_KEY: "sk-live" })).toBe("sk-live");
  });

  it("returns null when env var is missing", () => {
    expect(resolveSecret(cred, {})).toBeNull();
  });

  it("returns null when env var is blank/whitespace", () => {
    expect(resolveSecret(cred, { MY_API_KEY: "   " })).toBeNull();
    expect(resolveSecret(cred, { MY_API_KEY: "" })).toBeNull();
  });

  it("trims surrounding whitespace from the resolved value", () => {
    expect(resolveSecret(cred, { MY_API_KEY: "  sk-live  " })).toBe("sk-live");
  });
});
