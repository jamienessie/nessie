import { parseObject, asNumber, asString } from "@nessie/adapter-utils/server-utils";
import { DEFAULT_WINDSURF_COMMAND, DEFAULT_WINDSURF_MODEL } from "../constants.js";

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function parseEnvConfig(rawEnv: unknown): Record<string, string> {
  const parsed =
    typeof rawEnv === "string" && rawEnv.trim().length > 0
      ? safeParseJsonObject(rawEnv)
      : parseObject(rawEnv);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") env[key] = value;
  }
  return env;
}

export function safeParseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parseObject(parsed);
  } catch {
    return {};
  }
}

export function resolveWindsurfCommand(config: Record<string, unknown>): string {
  const command = asString(config.command, DEFAULT_WINDSURF_COMMAND).trim();
  return command || DEFAULT_WINDSURF_COMMAND;
}

export function resolveWindsurfModel(config: Record<string, unknown>): string {
  const model = asString(config.model, DEFAULT_WINDSURF_MODEL).trim();
  return model || DEFAULT_WINDSURF_MODEL;
}

export function buildWindsurfAcpxConfig(config: Record<string, unknown>): Record<string, unknown> {
  const command = resolveWindsurfCommand(config);
  const configuredAgentCommand = asString(config.agentCommand, "").trim();
  const env = parseEnvConfig(config.env);
  return {
    ...config,
    env,
    command,
    agent: "custom",
    agentCommand: configuredAgentCommand || `${shellQuote(command)} acp`,
    model: resolveWindsurfModel(config),
    mode: asString(config.mode, "persistent").trim() || "persistent",
    permissionMode: asString(config.permissionMode, "approve-all").trim() || "approve-all",
    nonInteractivePermissions: asString(config.nonInteractivePermissions, "deny").trim() || "deny",
    timeoutSec: asNumber(config.timeoutSec, 0),
    warmHandleIdleMs: asNumber(config.warmHandleIdleMs, 0),
  };
}
