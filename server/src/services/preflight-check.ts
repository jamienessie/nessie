// Plan §next-up. Pre-Flight Check.
//
// Deterministic checklist run immediately before a heartbeat run dispatches
// to the adapter, when the agent has runtimeConfig.preFlight === true.
// Catches the kinds of mistakes cheap models are most likely to make:
// acting on stale assumptions, missing a recent change, deploying with
// uncommitted local edits.
//
// Free-tier focus: pre-flight is deterministic — no LLM call, zero
// proxy cost. Every saved bad run is an avoided 1k-token retry plus a
// failed agent run that would have to be redone.
//
// Checks (v1):
//   - workspace_present: cwd exists and is a directory
//   - git_clean: `git status --porcelain` returns nothing (no
//     uncommitted local edits / untracked files)
//   - git_up_to_date: `git rev-list HEAD..@{u} --count` returns 0
//     (current branch isn't behind its tracked upstream)
//
// All checks are best-effort. A check that errors (e.g. not a git repo)
// is recorded as `skipped` rather than failed — the operator opts in
// per agent so non-git workflows simply skip.

import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

export type PreflightCheckStatus = "pass" | "fail" | "skipped";

export interface PreflightCheck {
  name: string;
  status: PreflightCheckStatus;
  detail?: string;
}

export interface PreflightResult {
  ok: boolean;
  checks: PreflightCheck[];
}

interface RunCmdResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCmd(cmd: string, args: string[], cwd: string, timeoutMs = 10_000): Promise<RunCmdResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
    const timer = setTimeout(() => {
      try { child.kill("SIGKILL"); } catch { /* ignore */ }
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve({ exitCode: -1, stdout, stderr });
    });
  });
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

export async function runPreFlightChecks(input: { cwd: string | null | undefined }): Promise<PreflightResult> {
  const checks: PreflightCheck[] = [];
  if (!input.cwd) {
    checks.push({ name: "workspace_present", status: "skipped", detail: "no cwd configured" });
    return { ok: true, checks };
  }
  if (!(await isDirectory(input.cwd))) {
    checks.push({ name: "workspace_present", status: "fail", detail: `cwd '${input.cwd}' is not a directory` });
    return { ok: false, checks };
  }
  checks.push({ name: "workspace_present", status: "pass" });

  // Probe whether this is a git working tree first; non-git workflows
  // skip the git checks entirely.
  const probe = await runCmd("git", ["rev-parse", "--is-inside-work-tree"], input.cwd, 5_000);
  if (probe.exitCode !== 0) {
    checks.push({ name: "git_clean", status: "skipped", detail: "not a git working tree" });
    checks.push({ name: "git_up_to_date", status: "skipped", detail: "not a git working tree" });
    return { ok: true, checks };
  }

  const status = await runCmd("git", ["status", "--porcelain"], input.cwd);
  if (status.exitCode !== 0) {
    checks.push({ name: "git_clean", status: "skipped", detail: status.stderr.trim().slice(0, 200) });
  } else if (status.stdout.trim().length === 0) {
    checks.push({ name: "git_clean", status: "pass" });
  } else {
    const sample = status.stdout.split("\n").slice(0, 5).map((l) => l.trim()).filter(Boolean).join("; ");
    checks.push({ name: "git_clean", status: "fail", detail: `dirty working tree: ${sample}` });
  }

  // git rev-list HEAD..@{u} --count is 0 iff HEAD is not behind upstream.
  // If there's no upstream tracking, skip — the operator may be on a
  // detached / freshly-created branch.
  const ahead = await runCmd("git", ["rev-list", "HEAD..@{u}", "--count"], input.cwd);
  if (ahead.exitCode !== 0) {
    checks.push({ name: "git_up_to_date", status: "skipped", detail: "no upstream tracking" });
  } else {
    const count = parseInt(ahead.stdout.trim(), 10);
    if (Number.isFinite(count) && count > 0) {
      checks.push({ name: "git_up_to_date", status: "fail", detail: `${count} commit(s) behind upstream` });
    } else {
      checks.push({ name: "git_up_to_date", status: "pass" });
    }
  }

  const failed = checks.some((c) => c.status === "fail");
  return { ok: !failed, checks };
}
