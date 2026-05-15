import { describe, expect, it } from "vitest";
import { resolveTosAwareness, tosAllowsAutomatedT1 } from "./tos-dial.js";

describe("resolveTosAwareness", () => {
  it("defaults to Conservative when env var is unset", () => {
    expect(resolveTosAwareness({})).toBe("Conservative");
  });

  it("returns Standard when env is set to Standard", () => {
    expect(resolveTosAwareness({ NESSIE_TOS_AWARENESS: "Standard" })).toBe("Standard");
  });

  it("returns Aggressive when env is set to Aggressive", () => {
    expect(resolveTosAwareness({ NESSIE_TOS_AWARENESS: "Aggressive" })).toBe("Aggressive");
  });

  it("falls back to Conservative on garbage env values", () => {
    expect(resolveTosAwareness({ NESSIE_TOS_AWARENESS: "MaximumYolo" })).toBe("Conservative");
    expect(resolveTosAwareness({ NESSIE_TOS_AWARENESS: "" })).toBe("Conservative");
    expect(resolveTosAwareness({ NESSIE_TOS_AWARENESS: "conservative" })).toBe("Conservative");
  });

  it("trims whitespace from valid values", () => {
    expect(resolveTosAwareness({ NESSIE_TOS_AWARENESS: "  Standard  " })).toBe("Standard");
  });
});

describe("tosAllowsAutomatedT1", () => {
  it("blocks automated T1 on Conservative", () => {
    expect(tosAllowsAutomatedT1("Conservative")).toBe(false);
  });

  it("allows automated T1 on Standard and Aggressive", () => {
    expect(tosAllowsAutomatedT1("Standard")).toBe(true);
    expect(tosAllowsAutomatedT1("Aggressive")).toBe(true);
  });
});
