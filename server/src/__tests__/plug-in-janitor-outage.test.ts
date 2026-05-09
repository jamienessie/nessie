import { describe, it, expect } from "vitest";
import {
  detectAdapterOutages,
  type AdapterFailureRecord,
} from "../services/plug-in-janitor-outage.js";
import { BROKEN_BINDING_ERROR_CODES } from "../services/plug-in-janitor.js";

// Pure-logic tests for the outage detection algorithm. No DB. No adapter
// HTTP. We only assert on the math: when does Hank decide an adapter is
// outage-broken vs noisy single-model failure.
//
// The supplementary-probe path (attempted < 2) requires real adapter
// catalogs and is exercised in integration tests.

function failureMap(
  entries: Array<[string, Array<[string, AdapterFailureRecord]>]>,
): Map<string, Map<string, AdapterFailureRecord>> {
  const outer = new Map<string, Map<string, AdapterFailureRecord>>();
  for (const [adapterType, perModel] of entries) {
    const inner = new Map<string, AdapterFailureRecord>();
    for (const [model, rec] of perModel) inner.set(model, rec);
    outer.set(adapterType, inner);
  }
  return outer;
}

describe("detectAdapterOutages", () => {
  it("declares an outage when 2+ models fail with the same dominant code", async () => {
    const failedModelsByAdapter = failureMap([
      [
        "gemini_compatible",
        [
          ["gemini-2.0-flash", { errorCode: "gemini_api_key_missing", errorMessage: "API key invalid" }],
          ["gemini-2.5-flash", { errorCode: "gemini_api_key_missing", errorMessage: "API key invalid" }],
        ],
      ],
    ]);
    const detected = await detectAdapterOutages({ companyId: "co1", failedModelsByAdapter });
    expect(detected).toHaveLength(1);
    expect(detected[0]!.adapterType).toBe("gemini_compatible");
    expect(detected[0]!.dominantErrorCode).toBe("gemini_api_key_missing");
    expect(detected[0]!.failed).toBe(2);
    expect(detected[0]!.attempted).toBe(2);
    expect(detected[0]!.failedModels.sort()).toEqual(["gemini-2.0-flash", "gemini-2.5-flash"]);
  });

  it("does NOT declare an outage when failures are split across distinct error codes (no dominant)", async () => {
    const failedModelsByAdapter = failureMap([
      [
        "openai_compatible",
        [
          ["gpt-4o-mini", { errorCode: "rate_limited", errorMessage: "429" }],
          ["gpt-4o", { errorCode: "model_not_found", errorMessage: "404" }],
          ["o1-mini", { errorCode: "auth_failed", errorMessage: "401" }],
        ],
      ],
    ]);
    const detected = await detectAdapterOutages({ companyId: "co1", failedModelsByAdapter });
    expect(detected).toHaveLength(0);
  });

  it("declares outage when dominant code reaches 70% share (3 of 4 failures)", async () => {
    const failedModelsByAdapter = failureMap([
      [
        "openrouter_compatible",
        [
          ["a", { errorCode: "rate_limited", errorMessage: "429" }],
          ["b", { errorCode: "rate_limited", errorMessage: "429" }],
          ["c", { errorCode: "rate_limited", errorMessage: "429" }],
          ["d", { errorCode: "model_not_found", errorMessage: "404" }],
        ],
      ],
    ]);
    const detected = await detectAdapterOutages({ companyId: "co1", failedModelsByAdapter });
    expect(detected).toHaveLength(1);
    expect(detected[0]!.dominantErrorCode).toBe("rate_limited");
  });

  it("does NOT declare outage when dominant code is below 70% (2 of 4)", async () => {
    const failedModelsByAdapter = failureMap([
      [
        "openrouter_compatible",
        [
          ["a", { errorCode: "rate_limited", errorMessage: "429" }],
          ["b", { errorCode: "rate_limited", errorMessage: "429" }],
          ["c", { errorCode: "model_not_found", errorMessage: "404" }],
          ["d", { errorCode: "auth_failed", errorMessage: "401" }],
        ],
      ],
    ]);
    const detected = await detectAdapterOutages({ companyId: "co1", failedModelsByAdapter });
    expect(detected).toHaveLength(0);
  });

  it("emits at most SAMPLE_MESSAGE_LIMIT distinct sample messages (3)", async () => {
    const failedModelsByAdapter = failureMap([
      [
        "gemini_compatible",
        [
          ["a", { errorCode: "x", errorMessage: "msg1" }],
          ["b", { errorCode: "x", errorMessage: "msg2" }],
          ["c", { errorCode: "x", errorMessage: "msg3" }],
          ["d", { errorCode: "x", errorMessage: "msg4" }],
          ["e", { errorCode: "x", errorMessage: "msg1" }], // dup
        ],
      ],
    ]);
    const detected = await detectAdapterOutages({ companyId: "co1", failedModelsByAdapter });
    expect(detected[0]!.sampleMessages).toHaveLength(3);
    expect(new Set(detected[0]!.sampleMessages).size).toBe(3); // distinct
  });

  it("truncates very long error messages with an ellipsis", async () => {
    const longMessage = "x".repeat(500);
    const failedModelsByAdapter = failureMap([
      [
        "gemini_compatible",
        [
          ["a", { errorCode: "x", errorMessage: longMessage }],
          ["b", { errorCode: "x", errorMessage: longMessage + "y" }],
        ],
      ],
    ]);
    const detected = await detectAdapterOutages({ companyId: "co1", failedModelsByAdapter });
    const sample = detected[0]!.sampleMessages[0]!;
    expect(sample.length).toBeLessThanOrEqual(240);
    expect(sample.endsWith("…")).toBe(true);
  });

  it("handles multiple adapters independently in one sweep", async () => {
    const failedModelsByAdapter = failureMap([
      [
        "gemini_compatible",
        [
          ["a", { errorCode: "auth_failed", errorMessage: "g1" }],
          ["b", { errorCode: "auth_failed", errorMessage: "g2" }],
        ],
      ],
      [
        "openai_compatible",
        [
          ["x", { errorCode: "rate_limited", errorMessage: "o1" }],
          ["y", { errorCode: "rate_limited", errorMessage: "o2" }],
        ],
      ],
    ]);
    const detected = await detectAdapterOutages({ companyId: "co1", failedModelsByAdapter });
    expect(detected.map((d) => d.adapterType).sort()).toEqual(["gemini_compatible", "openai_compatible"]);
  });
});

describe("BROKEN_BINDING_ERROR_CODES", () => {
  it("includes the codes that should auto-trigger a sweep on heartbeat failure", () => {
    const required = [
      "quota_exceeded",
      "rate_limit_exceeded",
      "rate_limited",
      "auth_failed",
      "unauthorized",
      "model_not_found",
      "gemini_non_free_model",
      "insufficient_quota",
      "gemini_api_key_missing",
    ];
    for (const code of required) {
      expect(BROKEN_BINDING_ERROR_CODES.has(code)).toBe(true);
    }
  });

  it("does NOT include benign or unrelated error codes", () => {
    const benign = ["network_timeout", "transient_upstream", "user_cancelled", "max_turns_exhausted"];
    for (const code of benign) {
      expect(BROKEN_BINDING_ERROR_CODES.has(code)).toBe(false);
    }
  });
});
