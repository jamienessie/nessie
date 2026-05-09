import { describe, expect, it, vi } from "vitest";
import { createWindsurfEnvironmentTester } from "./test.js";

function makeContext(config: Record<string, unknown> = {}) {
  return {
    companyId: "company-1",
    adapterType: "windsurf_local",
    config,
  };
}

function okProc(stdout = "", stderr = "") {
  return {
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdout,
    stderr,
  };
}

function failProc(stdout = "", stderr = "") {
  return {
    exitCode: 1,
    signal: null,
    timedOut: false,
    stdout,
    stderr,
  };
}

describe("windsurf_local environment diagnostics", () => {
  it("fails when the Devin command is not resolvable", async () => {
    const tester = createWindsurfEnvironmentTester({
      ensureDirectory: vi.fn(async () => undefined) as any,
      ensureCommandResolvable: vi.fn(async () => {
        throw new Error("missing devin");
      }) as any,
      runProcess: vi.fn(async () => okProc()) as any,
      now: () => 0,
    });

    const result = await tester(makeContext());

    expect(result.status).toBe("fail");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "windsurf_command_unresolvable", level: "error" }),
      ]),
    );
  });

  it("warns when command works but auth is missing", async () => {
    const tester = createWindsurfEnvironmentTester({
      ensureDirectory: vi.fn(async () => undefined) as any,
      ensureCommandResolvable: vi.fn(async () => undefined) as any,
      runProcess: vi
        .fn()
        .mockResolvedValueOnce(okProc("devin 1.0.0"))
        .mockResolvedValueOnce(failProc("", "not logged in")) as any,
      now: () => 0,
    });

    const result = await tester(makeContext());

    expect(result.status).toBe("warn");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "windsurf_version_ok", level: "info" }),
        expect.objectContaining({ code: "windsurf_auth_missing", level: "warn" }),
      ]),
    );
  });

  it("passes auth checks when WINDSURF_API_KEY is configured", async () => {
    const runProcess = vi.fn(async () => okProc("devin 1.0.0"));
    const tester = createWindsurfEnvironmentTester({
      ensureDirectory: vi.fn(async () => undefined) as any,
      ensureCommandResolvable: vi.fn(async () => undefined) as any,
      runProcess: runProcess as any,
      now: () => 0,
    });

    const result = await tester(makeContext({
      env: '{"WINDSURF_API_KEY":"token"}',
    }));

    expect(result.status).toBe("pass");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "windsurf_api_key_present", level: "info" }),
      ]),
    );
    expect(runProcess).toHaveBeenCalledTimes(1);
  });

  it("runs an explicit hello probe when requested", async () => {
    const runProcess = vi
      .fn()
      .mockResolvedValueOnce(okProc("devin 1.0.0"))
      .mockResolvedValueOnce(okProc("logged in"))
      .mockResolvedValueOnce(okProc("hello"));
    const tester = createWindsurfEnvironmentTester({
      ensureDirectory: vi.fn(async () => undefined) as any,
      ensureCommandResolvable: vi.fn(async () => undefined) as any,
      runProcess: runProcess as any,
      now: () => 0,
    });

    const result = await tester(makeContext({ runHelloProbe: true }));

    expect(result.status).toBe("pass");
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "windsurf_hello_probe_passed", level: "info" }),
      ]),
    );
    expect(runProcess.mock.calls[2][3]).toEqual([
      "--model",
      "swe-1-6-fast",
      "--print",
      "Respond with hello.",
    ]);
  });
});
