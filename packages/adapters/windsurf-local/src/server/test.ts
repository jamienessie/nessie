import type {
  AdapterEnvironmentCheck,
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
} from "@nessie/adapter-utils";
import {
  ensurePathInEnv,
  asBoolean,
  parseObject,
} from "@nessie/adapter-utils/server-utils";
import {
  ensureAdapterExecutionTargetCommandResolvable,
  ensureAdapterExecutionTargetDirectory,
  resolveAdapterExecutionTargetCwd,
  runAdapterExecutionTargetProcess,
} from "@nessie/adapter-utils/execution-target";
import {
  buildWindsurfAcpxConfig,
  parseEnvConfig,
  resolveWindsurfCommand,
  resolveWindsurfModel,
} from "./config.js";

function summarizeStatus(checks: AdapterEnvironmentCheck[]): AdapterEnvironmentTestResult["status"] {
  if (checks.some((check) => check.level === "error")) return "fail";
  if (checks.some((check) => check.level === "warn")) return "warn";
  return "pass";
}

function firstNonEmptyLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ""
  );
}

function summarizeDetail(stdout: string, stderr: string): string | null {
  const raw = firstNonEmptyLine(stderr) || firstNonEmptyLine(stdout);
  if (!raw) return null;
  const clean = raw.replace(/\s+/g, " ").trim();
  return clean.length > 240 ? `${clean.slice(0, 239)}...` : clean;
}

function hasNonEmptyEnv(env: Record<string, string>, key: string): boolean {
  return typeof env[key] === "string" && env[key].trim().length > 0;
}

export type WindsurfEnvironmentTesterDeps = {
  ensureDirectory?: typeof ensureAdapterExecutionTargetDirectory;
  ensureCommandResolvable?: typeof ensureAdapterExecutionTargetCommandResolvable;
  runProcess?: typeof runAdapterExecutionTargetProcess;
  now?: () => number;
};

export function createWindsurfEnvironmentTester(deps: WindsurfEnvironmentTesterDeps = {}) {
  const ensureDirectory = deps.ensureDirectory ?? ensureAdapterExecutionTargetDirectory;
  const ensureCommandResolvable = deps.ensureCommandResolvable ?? ensureAdapterExecutionTargetCommandResolvable;
  const runProcess = deps.runProcess ?? runAdapterExecutionTargetProcess;
  const now = deps.now ?? (() => Date.now());

  return async function testWindsurfEnvironment(
    ctx: AdapterEnvironmentTestContext,
  ): Promise<AdapterEnvironmentTestResult> {
    const rawConfig = parseObject(ctx.config);
    const config = buildWindsurfAcpxConfig(rawConfig);
    const target = ctx.executionTarget ?? null;
    const runId = `windsurf-envtest-${now()}-${Math.random().toString(16).slice(2)}`;
    const cwd = resolveAdapterExecutionTargetCwd(target, String(config.cwd ?? ""), process.cwd());
    const command = resolveWindsurfCommand(config);
    const env = parseEnvConfig(config.env);
    const runtimeEnv = ensurePathInEnv({ ...process.env, ...env });
    const checks: AdapterEnvironmentCheck[] = [];

    try {
      await ensureDirectory(runId, target, cwd, {
        cwd,
        env,
        createIfMissing: true,
      });
      checks.push({
        code: "windsurf_cwd_valid",
        level: "info",
        message: `Working directory is valid: ${cwd}`,
      });
    } catch (err) {
      checks.push({
        code: "windsurf_cwd_invalid",
        level: "error",
        message: err instanceof Error ? err.message : "Invalid working directory",
        detail: cwd,
      });
    }

    try {
      await ensureCommandResolvable(command, target, cwd, runtimeEnv);
      checks.push({
        code: "windsurf_command_resolvable",
        level: "info",
        message: `Devin command is executable: ${command}`,
      });
    } catch (err) {
      checks.push({
        code: "windsurf_command_unresolvable",
        level: "error",
        message: err instanceof Error ? err.message : "Devin command is not executable",
        detail: command,
        hint: "Install Devin for Terminal or configure the adapter command path.",
      });
    }

    const canRunCommand = !checks.some((check) => check.code === "windsurf_command_unresolvable");
    if (canRunCommand) {
      const version = await runProcess(runId, target, command, ["version"], {
        cwd,
        env,
        timeoutSec: 20,
        graceSec: 5,
        onLog: async () => {},
      });
      if (version.timedOut) {
        checks.push({
          code: "windsurf_version_timed_out",
          level: "warn",
          message: "`devin version` timed out.",
        });
      } else if ((version.exitCode ?? 1) === 0) {
        checks.push({
          code: "windsurf_version_ok",
          level: "info",
          message: "Devin for Terminal responded to `devin version`.",
          detail: summarizeDetail(version.stdout, version.stderr),
        });
      } else {
        checks.push({
          code: "windsurf_version_failed",
          level: "warn",
          message: "`devin version` failed.",
          detail: summarizeDetail(version.stdout, version.stderr),
          hint: "Run `devin version` manually in the same environment to inspect the install.",
        });
      }
    }

    const authEnv = Object.fromEntries(
      Object.entries({ ...process.env, ...env }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
    if (hasNonEmptyEnv(authEnv, "WINDSURF_API_KEY")) {
      checks.push({
        code: "windsurf_api_key_present",
        level: "info",
        message: "WINDSURF_API_KEY is configured for Devin ACP authentication.",
        detail: hasNonEmptyEnv(env, "WINDSURF_API_KEY") ? "Detected in adapter config env." : "Detected in server environment.",
      });
    } else if (canRunCommand) {
      const auth = await runProcess(runId, target, command, ["auth", "status"], {
        cwd,
        env,
        timeoutSec: 20,
        graceSec: 5,
        onLog: async () => {},
      });
      if ((auth.exitCode ?? 1) === 0) {
        checks.push({
          code: "windsurf_native_auth_present",
          level: "info",
          message: "Devin for Terminal reports an authenticated account.",
          detail: summarizeDetail(auth.stdout, auth.stderr),
        });
      } else {
        checks.push({
          code: "windsurf_auth_missing",
          level: "warn",
          message: "No WINDSURF_API_KEY was found and `devin auth status` did not report a ready login.",
          detail: summarizeDetail(auth.stdout, auth.stderr),
          hint: "Run `devin auth login --force-manual-token-flow` or set WINDSURF_API_KEY through Paperclip secret-backed env.",
        });
      }
    }

    if (asBoolean(rawConfig.runHelloProbe, false) && canRunCommand) {
      const model = resolveWindsurfModel(config);
      const probe = await runProcess(runId, target, command, ["--model", model, "--print", "Respond with hello."], {
        cwd,
        env,
        timeoutSec: 60,
        graceSec: 5,
        onLog: async () => {},
      });
      const detail = summarizeDetail(probe.stdout, probe.stderr);
      if (probe.timedOut) {
        checks.push({
          code: "windsurf_hello_probe_timed_out",
          level: "warn",
          message: "Windsurf hello probe timed out.",
        });
      } else if ((probe.exitCode ?? 1) === 0 && /\bhello\b/i.test(`${probe.stdout}\n${probe.stderr}`)) {
        checks.push({
          code: "windsurf_hello_probe_passed",
          level: "info",
          message: "Windsurf SWE hello probe succeeded.",
          detail,
        });
      } else {
        checks.push({
          code: "windsurf_hello_probe_failed",
          level: "warn",
          message: "Windsurf SWE hello probe did not return the expected response.",
          detail,
          hint: `Try \`${command} --model ${model} --print "Respond with hello."\` manually.`,
        });
      }
    }

    checks.push({
      code: "windsurf_runtime_scaffold",
      level: "info",
      message: "windsurf_local will launch Devin for Terminal through ACP as a persistent session.",
    });

    return {
      adapterType: ctx.adapterType,
      status: summarizeStatus(checks),
      checks,
      testedAt: new Date(now()).toISOString(),
    };
  };
}

export const testEnvironment = createWindsurfEnvironmentTester();
