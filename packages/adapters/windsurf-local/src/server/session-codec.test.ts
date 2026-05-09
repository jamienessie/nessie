import { describe, expect, it } from "vitest";
import { sessionCodec } from "./session-codec.js";

describe("windsurf_local session codec", () => {
  it("round-trips ACPX session params and display id", () => {
    const params = {
      runtimeSessionName: "paperclip:session",
      acpSessionId: "acp-123",
      agentSessionId: "agent-456",
      agent: "custom",
      cwd: "C:/repo",
      mode: "persistent",
      configFingerprint: "abc",
      remoteExecution: { kind: "local" },
    };

    const serialized = sessionCodec.serialize(params);
    expect(serialized).toMatchObject(params);
    expect(sessionCodec.deserialize(serialized)).toMatchObject(params);
    expect(sessionCodec.getDisplayId?.(serialized)).toBe("paperclip:session");
  });

  it("rejects empty session params", () => {
    expect(sessionCodec.deserialize({ cwd: "C:/repo" })).toBeNull();
    expect(sessionCodec.serialize(null)).toBeNull();
  });
});
