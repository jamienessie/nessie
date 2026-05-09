import { describe, expect, it } from "vitest";
import { createServerAdapter } from "../index.js";
import {
  buildWindsurfAcpxConfig,
  parseEnvConfig,
  resolveWindsurfCommand,
  resolveWindsurfModel,
} from "./config.js";

describe("windsurf_local config", () => {
  it("shapes adapter config into an ACPX custom Devin ACP command", () => {
    const shaped = buildWindsurfAcpxConfig({
      env: '{ "WINDSURF_API_KEY": "token", "IGNORED": 42 }',
      timeoutSec: 120,
    });

    expect(shaped).toMatchObject({
      agent: "custom",
      agentCommand: "'devin' acp",
      command: "devin",
      model: "swe-1-6-fast",
      mode: "persistent",
      permissionMode: "approve-all",
      nonInteractivePermissions: "deny",
      timeoutSec: 120,
      warmHandleIdleMs: 0,
      env: {
        WINDSURF_API_KEY: "token",
      },
    });
  });

  it("allows command, model, env, and agentCommand overrides", () => {
    const shaped = buildWindsurfAcpxConfig({
      command: "devin-nightly",
      agentCommand: "custom-devin acp --trace",
      model: "swe",
      env: {
        WINDSURF_API_KEY: "configured",
      },
    });

    expect(resolveWindsurfCommand(shaped)).toBe("devin-nightly");
    expect(resolveWindsurfModel(shaped)).toBe("swe");
    expect(shaped.agentCommand).toBe("custom-devin acp --trace");
    expect(parseEnvConfig(shaped.env)).toEqual({ WINDSURF_API_KEY: "configured" });
  });

  it("createServerAdapter declares plugin-facing capabilities", async () => {
    const adapter = createServerAdapter();

    expect(adapter.type).toBe("windsurf_local");
    expect(adapter.supportsLocalAgentJwt).toBe(true);
    expect(adapter.supportsInstructionsBundle).toBe(true);
    expect(adapter.listSkills).toBeTypeOf("function");
    expect(adapter.syncSkills).toBeTypeOf("function");
    expect(adapter.getConfigSchema).toBeTypeOf("function");
    expect(adapter.getRuntimeCommandSpec?.({ command: "devin" })).toMatchObject({
      command: "devin",
      detectCommand: "devin",
    });
    await expect(adapter.detectModel?.()).resolves.toMatchObject({
      model: "swe-1-6-fast",
      provider: "windsurf",
    });
  });
});
