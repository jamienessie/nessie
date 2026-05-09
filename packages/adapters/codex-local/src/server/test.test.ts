import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetDirectory,
  maybeRunSandboxInstallCommand,
  runAdapterExecutionTargetProcess,
} = vi.hoisted(() => ({
  ensureAdapterExecutionTargetCommandResolvable: vi.fn(async (..._args: unknown[]) => undefined),
  ensureAdapterExecutionTargetDirectory: vi.fn(async () => undefined),
  maybeRunSandboxInstallCommand: vi.fn(async () => null),
  runAdapterExecutionTargetProcess: vi.fn(async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout: JSON.stringify({
      type: "item.completed",
      item: { type: "agent_message", text: "hello" },
    }) + "\n",
    stderr: "",
    pid: 123,
    startedAt: new Date().toISOString(),
  })),
}));

vi.mock("@nessie/adapter-utils/execution-target", async () => {
  const actual = await vi.importActual<typeof import("@nessie/adapter-utils/execution-target")>(
    "@nessie/adapter-utils/execution-target",
  );
  return {
    ...actual,
    ensureAdapterExecutionTargetCommandResolvable,
    ensureAdapterExecutionTargetDirectory,
    maybeRunSandboxInstallCommand,
    runAdapterExecutionTargetProcess,
  };
});

import { testEnvironment } from "./test.js";

describe("Codex local environment test", () => {
  let codexHome: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "paperclip-codex-envtest-"));
    await fs.writeFile(path.join(codexHome, "auth.json"), JSON.stringify({ accessToken: "token" }), "utf8");
    vi.stubEnv("CODEX_HOME", codexHome);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fs.rm(codexHome, { recursive: true, force: true }).catch(() => undefined);
  });

  it.skipIf(process.platform !== "win32")("adds the standard Windows Codex install directory before resolving codex", async () => {
    vi.stubEnv("PATH", "C:\\Windows\\System32");
    vi.stubEnv("LOCALAPPDATA", "C:\\Users\\paperclip\\AppData\\Local");
    vi.stubEnv("APPDATA", "C:\\Users\\paperclip\\AppData\\Roaming");
    ensureAdapterExecutionTargetCommandResolvable.mockImplementationOnce(async (...args: unknown[]) => {
      const env = args[3] as NodeJS.ProcessEnv;
      const pathValue = env.PATH ?? env.Path ?? "";
      if (!pathValue.toLowerCase().includes("\\openai\\codex\\bin")) {
        throw new Error('Command not found in PATH: "codex"');
      }
    });

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "codex_local",
      config: {},
    });

    expect(result.status).toBe("pass");
    expect(ensureAdapterExecutionTargetCommandResolvable).toHaveBeenCalledWith(
      "codex",
      null,
      process.cwd(),
      expect.objectContaining({
        PATH: expect.stringContaining("C:\\Users\\paperclip\\AppData\\Local\\OpenAI\\Codex\\bin"),
      }),
    );
    expect(runAdapterExecutionTargetProcess).toHaveBeenCalledWith(
      expect.any(String),
      null,
      "codex",
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({
          PATH: expect.stringContaining("C:\\Users\\paperclip\\AppData\\Local\\OpenAI\\Codex\\bin"),
        }),
      }),
    );
  });

  it.skipIf(process.platform !== "win32")("adds a Windows-specific hint when codex is still not resolvable", async () => {
    ensureAdapterExecutionTargetCommandResolvable.mockRejectedValueOnce(
      new Error('Command not found in PATH: "codex"'),
    );

    const result = await testEnvironment({
      companyId: "company-1",
      adapterType: "codex_local",
      config: {},
    });

    expect(result.status).toBe("fail");
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "codex_command_unresolvable",
        hint: expect.stringContaining("absolute codex.exe path"),
      }),
    );
    expect(result.checks).toContainEqual(
      expect.objectContaining({
        code: "codex_native_auth_present",
      }),
    );
  });
});
