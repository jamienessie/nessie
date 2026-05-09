import { describe, expect, it } from "vitest";
import {
  isCodexLocalKnownModel,
  isCodexLocalManualModel,
  models,
} from "./index.js";

describe("codex_local shared model catalog", () => {
  it("includes gpt-5.4-mini as a known model", () => {
    expect(models.some((model) => model.id === "gpt-5.4-mini")).toBe(true);
    expect(isCodexLocalKnownModel("gpt-5.4-mini")).toBe(true);
    expect(isCodexLocalManualModel("gpt-5.4-mini")).toBe(false);
  });
});
