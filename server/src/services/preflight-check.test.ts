import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPreFlightChecks } from "./preflight-check.js";

describe("runPreFlightChecks", () => {
  it("skips everything when no cwd is provided", async () => {
    const result = await runPreFlightChecks({ cwd: null });
    expect(result.ok).toBe(true);
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({ name: "workspace_present", status: "skipped" });
  });

  it("fails when cwd is not a directory", async () => {
    const result = await runPreFlightChecks({ cwd: "/no/such/dir/should/exist/here" });
    expect(result.ok).toBe(false);
    expect(result.checks[0].status).toBe("fail");
  });

  it("skips git checks when cwd is a directory but not a git repo", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-"));
    try {
      const result = await runPreFlightChecks({ cwd: dir });
      expect(result.ok).toBe(true);
      const gitClean = result.checks.find((c) => c.name === "git_clean");
      const gitUp = result.checks.find((c) => c.name === "git_up_to_date");
      expect(gitClean?.status).toBe("skipped");
      expect(gitUp?.status).toBe("skipped");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("includes a workspace_present pass when cwd exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "preflight-"));
    try {
      writeFileSync(join(dir, "x.txt"), "x");
      const result = await runPreFlightChecks({ cwd: dir });
      expect(result.checks[0]).toMatchObject({ name: "workspace_present", status: "pass" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
