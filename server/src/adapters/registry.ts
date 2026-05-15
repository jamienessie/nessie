import type {
  AdapterModel,
  AdapterModelProfileDefinition,
  AdapterRuntimeCommandSpec,
  ServerAdapterModule,
} from "./types.js";
import { getAdapterSessionManagement } from "@nessie/adapter-utils";
import {
  execute as claudeExecute,
  listClaudeSkills,
  syncClaudeSkills,
  listClaudeModels,
  testEnvironment as claudeTestEnvironment,
  sessionCodec as claudeSessionCodec,
  getQuotaWindows as claudeGetQuotaWindows,
} from "@nessie/adapter-claude-local/server";
import {
  agentConfigurationDoc as claudeAgentConfigurationDoc,
  models as claudeModels,
  modelProfiles as claudeModelProfiles,
} from "@nessie/adapter-claude-local";
import {
  execute as codexExecute,
  listCodexSkills,
  syncCodexSkills,
  testEnvironment as codexTestEnvironment,
  sessionCodec as codexSessionCodec,
  getQuotaWindows as codexGetQuotaWindows,
} from "@nessie/adapter-codex-local/server";
import {
  agentConfigurationDoc as codexAgentConfigurationDoc,
  models as codexModels,
  modelProfiles as codexModelProfiles,
} from "@nessie/adapter-codex-local";
import {
  execute as openCodeLocalExecute,
  listOpenCodeSkills,
  syncOpenCodeSkills,
  testEnvironment as openCodeLocalTestEnvironment,
  sessionCodec as openCodeLocalSessionCodec,
} from "@nessie/adapter-opencode-local/server";
import {
  agentConfigurationDoc as openCodeLocalAgentConfigurationDoc,
  models as openCodeLocalModels,
  modelProfiles as openCodeLocalModelProfiles,
} from "@nessie/adapter-opencode-local";
import { createServerAdapter as createWindsurfLocalAdapter } from "@nessie/adapter-windsurf-local";
import {
  execute as openAiCompatibleExecute,
  testEnvironment as openAiCompatibleTestEnvironment,
  sessionCodec as openAiCompatibleSessionCodec,
} from "@nessie/adapter-openai-compatible/server";
import {
  agentConfigurationDoc as openAiCompatibleAgentConfigurationDoc,
  models as openAiCompatibleModels,
  modelProfiles as openAiCompatibleModelProfiles,
} from "@nessie/adapter-openai-compatible";
import {
  execute as openRouterCompatibleExecute,
  listOpenRouterModels,
  refreshOpenRouterModels,
  testEnvironment as openRouterCompatibleTestEnvironment,
  sessionCodec as openRouterCompatibleSessionCodec,
} from "@nessie/adapter-openrouter-compatible/server";
import {
  agentConfigurationDoc as openRouterCompatibleAgentConfigurationDoc,
  models as openRouterCompatibleModels,
  modelProfiles as openRouterCompatibleModelProfiles,
} from "@nessie/adapter-openrouter-compatible";
import {
  execute as geminiCompatibleExecute,
  listGeminiModels,
  refreshGeminiModels,
  testEnvironment as geminiCompatibleTestEnvironment,
  sessionCodec as geminiCompatibleSessionCodec,
} from "@nessie/adapter-gemini-compatible/server";
import {
  agentConfigurationDoc as geminiCompatibleAgentConfigurationDoc,
  models as geminiCompatibleModels,
  modelProfiles as geminiCompatibleModelProfiles,
} from "@nessie/adapter-gemini-compatible";
import {
  execute as azureOpenaiExecute,
  listAzureOpenaiModels,
  refreshAzureOpenaiModels,
  testEnvironment as azureOpenaiTestEnvironment,
  sessionCodec as azureOpenaiSessionCodec,
} from "@nessie/adapter-azure-openai/server";
import {
  agentConfigurationDoc as azureOpenaiAgentConfigurationDoc,
  models as azureOpenaiModels,
  modelProfiles as azureOpenaiModelProfiles,
} from "@nessie/adapter-azure-openai";
import {
  execute as httpWebhookExecute,
  testEnvironment as httpWebhookTestEnvironment,
  sessionCodec as httpWebhookSessionCodec,
} from "@nessie/adapter-http-webhook/server";
import {
  agentConfigurationDoc as httpWebhookAgentConfigurationDoc,
  models as httpWebhookModels,
} from "@nessie/adapter-http-webhook";
import { listCodexModels, refreshCodexModels } from "./codex-models.js";
import { BUILTIN_ADAPTER_TYPES } from "./builtin-adapter-types.js";
import { buildExternalAdapters } from "./plugin-loader.js";
import { getDisabledAdapterTypes } from "../services/adapter-plugin-store.js";
import { processAdapter } from "./process/index.js";
import { httpAdapter } from "./http/index.js";

function readConfiguredCommand(config: Record<string, unknown>, fallback: string): string {
  const value = typeof config.command === "string" ? config.command.trim() : "";
  return value.length > 0 ? value : fallback;
}

function hasPathSeparator(command: string): boolean {
  return command.includes("/") || command.includes("\\");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function buildNpmRuntimeCommandSpec(
  config: Record<string, unknown>,
  fallbackCommand: string,
  packageName: string,
): AdapterRuntimeCommandSpec {
  const command = readConfiguredCommand(config, fallbackCommand);
  const canSelfInstall = !hasPathSeparator(command) && command === fallbackCommand;
  return {
    command,
    detectCommand: command,
    installCommand: canSelfInstall
      ? `if ! command -v ${shellQuote(command)} >/dev/null 2>&1; then npm install -g ${shellQuote(packageName)}; fi`
      : null,
  };
}

const claudeLocalAdapter: ServerAdapterModule = {
  type: "claude_local",
  execute: claudeExecute,
  testEnvironment: claudeTestEnvironment,
  listSkills: listClaudeSkills,
  syncSkills: syncClaudeSkills,
  sessionCodec: claudeSessionCodec,
  sessionManagement: getAdapterSessionManagement("claude_local") ?? undefined,
  models: claudeModels,
  modelProfiles: claudeModelProfiles,
  listModels: listClaudeModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: false,
  getRuntimeCommandSpec: (config) =>
    buildNpmRuntimeCommandSpec(config, "claude", "@anthropic-ai/claude-code"),
  agentConfigurationDoc: claudeAgentConfigurationDoc,
  getQuotaWindows: claudeGetQuotaWindows,
};

const codexLocalAdapter: ServerAdapterModule = {
  type: "codex_local",
  execute: codexExecute,
  testEnvironment: codexTestEnvironment,
  listSkills: listCodexSkills,
  syncSkills: syncCodexSkills,
  sessionCodec: codexSessionCodec,
  sessionManagement: getAdapterSessionManagement("codex_local") ?? undefined,
  models: codexModels,
  modelProfiles: codexModelProfiles,
  listModels: listCodexModels,
  refreshModels: refreshCodexModels,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: false,
  getRuntimeCommandSpec: (config) => buildNpmRuntimeCommandSpec(config, "codex", "@openai/codex"),
  agentConfigurationDoc: codexAgentConfigurationDoc,
  getQuotaWindows: codexGetQuotaWindows,
};

const openCodeLocalAdapter: ServerAdapterModule = {
  type: "opencode_local",
  execute: openCodeLocalExecute,
  testEnvironment: openCodeLocalTestEnvironment,
  listSkills: listOpenCodeSkills,
  syncSkills: syncOpenCodeSkills,
  sessionCodec: openCodeLocalSessionCodec,
  sessionManagement: getAdapterSessionManagement("opencode_local") ?? undefined,
  models: openCodeLocalModels,
  modelProfiles: openCodeLocalModelProfiles,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: true,
  instructionsPathKey: "instructionsFilePath",
  requiresMaterializedRuntimeSkills: false,
  getRuntimeCommandSpec: (config) => buildNpmRuntimeCommandSpec(config, "opencode", "opencode-ai"),
  agentConfigurationDoc: openCodeLocalAgentConfigurationDoc,
};

const windsurfLocalAdapterBase = createWindsurfLocalAdapter();
const windsurfLocalAdapter: ServerAdapterModule = {
  ...windsurfLocalAdapterBase,
  sessionManagement:
    getAdapterSessionManagement("windsurf_local") ?? windsurfLocalAdapterBase.sessionManagement,
};

const openAiCompatibleAdapter: ServerAdapterModule = {
  type: "openai_compatible",
  execute: openAiCompatibleExecute,
  testEnvironment: openAiCompatibleTestEnvironment,
  sessionCodec: openAiCompatibleSessionCodec,
  sessionManagement: getAdapterSessionManagement("openai_compatible") ?? undefined,
  models: openAiCompatibleModels,
  modelProfiles: openAiCompatibleModelProfiles,
  supportsLocalAgentJwt: true,
  supportsInstructionsBundle: false,
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: openAiCompatibleAgentConfigurationDoc,
};

const openRouterCompatibleAdapter: ServerAdapterModule = {
  type: "openrouter_compatible",
  execute: openRouterCompatibleExecute,
  testEnvironment: openRouterCompatibleTestEnvironment,
  sessionCodec: openRouterCompatibleSessionCodec,
  sessionManagement: getAdapterSessionManagement("openrouter_compatible") ?? undefined,
  models: openRouterCompatibleModels,
  modelProfiles: openRouterCompatibleModelProfiles,
  listModels: listOpenRouterModels,
  refreshModels: refreshOpenRouterModels,
  supportsLocalAgentJwt: false,
  supportsInstructionsBundle: false,
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: openRouterCompatibleAgentConfigurationDoc,
};

const geminiCompatibleAdapter: ServerAdapterModule = {
  type: "gemini_compatible",
  execute: geminiCompatibleExecute,
  testEnvironment: geminiCompatibleTestEnvironment,
  sessionCodec: geminiCompatibleSessionCodec,
  sessionManagement: getAdapterSessionManagement("gemini_compatible") ?? undefined,
  models: geminiCompatibleModels,
  modelProfiles: geminiCompatibleModelProfiles,
  listModels: listGeminiModels,
  refreshModels: refreshGeminiModels,
  supportsLocalAgentJwt: false,
  supportsInstructionsBundle: false,
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: geminiCompatibleAgentConfigurationDoc,
};

const azureOpenaiAdapter: ServerAdapterModule = {
  type: "azure_openai",
  execute: azureOpenaiExecute,
  testEnvironment: azureOpenaiTestEnvironment,
  sessionCodec: azureOpenaiSessionCodec,
  sessionManagement: getAdapterSessionManagement("azure_openai") ?? undefined,
  models: azureOpenaiModels,
  modelProfiles: azureOpenaiModelProfiles,
  listModels: listAzureOpenaiModels,
  refreshModels: refreshAzureOpenaiModels,
  supportsLocalAgentJwt: false,
  supportsInstructionsBundle: false,
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: azureOpenaiAgentConfigurationDoc,
};

const httpWebhookAdapter: ServerAdapterModule = {
  type: "http_webhook",
  execute: httpWebhookExecute,
  testEnvironment: httpWebhookTestEnvironment,
  sessionCodec: httpWebhookSessionCodec,
  sessionManagement: getAdapterSessionManagement("http_webhook") ?? undefined,
  models: httpWebhookModels,
  supportsLocalAgentJwt: false,
  supportsInstructionsBundle: false,
  requiresMaterializedRuntimeSkills: false,
  agentConfigurationDoc: httpWebhookAgentConfigurationDoc,
};

const adaptersByType = new Map<string, ServerAdapterModule>();

// For builtin types that are overridden by an external adapter, we keep the
// original builtin so it can be restored when the override is deactivated.
const builtinFallbacks = new Map<string, ServerAdapterModule>();

// Tracks which override types are currently deactivated (paused).  When
// paused, `getServerAdapter()` returns the builtin fallback instead of the
// external.  Persisted across reloads via the same disabled-adapters store.
const pausedOverrides = new Set<string>();

function registerBuiltInAdapters() {
  // Nessie Phase 1 catalog: builtin agent adapters plus the two
  // adapter-plugin transports (process / http). Other Paperclip adapters
  // (cursor / gemini_local / acpx / pi / openclaw-gateway / hermes)
  // remain on disk as workspace packages but are no longer registered.
  for (const adapter of [
    claudeLocalAdapter,
    codexLocalAdapter,
    openCodeLocalAdapter,
    windsurfLocalAdapter,
    openAiCompatibleAdapter,
    openRouterCompatibleAdapter,
    geminiCompatibleAdapter,
    azureOpenaiAdapter,
    httpWebhookAdapter,
    processAdapter,
    httpAdapter,
  ]) {
    adaptersByType.set(adapter.type, adapter);
  }
}

registerBuiltInAdapters();

// ---------------------------------------------------------------------------
// Load external adapter plugins
//
// External adapter packages export createServerAdapter() which returns a
// ServerAdapterModule. When the module provides its own sessionManagement
// it is preserved; otherwise the host falls back to the built-in registry
// lookup (so externals that override a built-in type inherit the builtin's
// policy).
// ---------------------------------------------------------------------------

/** Cached sync wrapper — the store is a simple JSON file read, safe to call frequently. */
function getDisabledAdapterTypesFromStore(): string[] {
  return getDisabledAdapterTypes();
}

/**
 * Merge an external adapter module with host-provided session management.
 *
 * Module-provided `sessionManagement` takes precedence. When absent, fall
 * back to the hardcoded registry keyed by adapter type.
 */
export function resolveExternalAdapterRegistration(
  externalAdapter: ServerAdapterModule,
): ServerAdapterModule {
  return {
    ...externalAdapter,
    sessionManagement:
      externalAdapter.sessionManagement
        ?? getAdapterSessionManagement(externalAdapter.type)
        ?? undefined,
  };
}

/**
 * Load external adapters from the plugin store. Called once at module
 * initialization.
 */
const externalAdaptersReady: Promise<void> = (async () => {
  try {
    const externalAdapters = await buildExternalAdapters();
    for (const externalAdapter of externalAdapters) {
      const overriding = BUILTIN_ADAPTER_TYPES.has(externalAdapter.type);
      if (overriding) {
        console.log(
          `[nessie] External adapter "${externalAdapter.type}" overrides built-in adapter`,
        );
        const existing = adaptersByType.get(externalAdapter.type);
        if (existing && !builtinFallbacks.has(externalAdapter.type)) {
          builtinFallbacks.set(externalAdapter.type, existing);
        }
      }
      adaptersByType.set(
        externalAdapter.type,
        resolveExternalAdapterRegistration(externalAdapter),
      );
    }
  } catch (err) {
    console.error("[nessie] Failed to load external adapters:", err);
  }
})();

export function waitForExternalAdapters(): Promise<void> {
  return externalAdaptersReady;
}

export function registerServerAdapter(adapter: ServerAdapterModule): void {
  if (BUILTIN_ADAPTER_TYPES.has(adapter.type) && !builtinFallbacks.has(adapter.type)) {
    const existing = adaptersByType.get(adapter.type);
    if (existing) {
      builtinFallbacks.set(adapter.type, existing);
    }
  }
  adaptersByType.set(adapter.type, adapter);
}

export function unregisterServerAdapter(type: string): void {
  if (type === processAdapter.type || type === httpAdapter.type) return;
  if (builtinFallbacks.has(type)) {
    pausedOverrides.delete(type);
    const fallback = builtinFallbacks.get(type);
    if (fallback) {
      adaptersByType.set(type, fallback);
    }
    return;
  }
  if (BUILTIN_ADAPTER_TYPES.has(type)) {
    return;
  }
  adaptersByType.delete(type);
}

export function requireServerAdapter(type: string): ServerAdapterModule {
  const adapter = findActiveServerAdapter(type);
  if (!adapter) {
    throw new Error(`Unknown adapter type: ${type}`);
  }
  return adapter;
}

export function getServerAdapter(type: string): ServerAdapterModule {
  return findActiveServerAdapter(type) ?? processAdapter;
}

export async function listAdapterModels(type: string): Promise<{ id: string; label: string }[]> {
  const adapter = findActiveServerAdapter(type);
  if (!adapter) return [];
  if (adapter.listModels) {
    const discovered = await adapter.listModels();
    if (discovered.length > 0) return discovered;
  }
  return adapter.models ?? [];
}

export async function refreshAdapterModels(type: string): Promise<{ id: string; label: string }[]> {
  const adapter = findActiveServerAdapter(type);
  if (!adapter) return [];
  if (adapter.refreshModels) {
    const refreshed = await adapter.refreshModels();
    if (refreshed.length > 0) return refreshed;
  }
  if (adapter.listModels) {
    const discovered = await adapter.listModels();
    if (discovered.length > 0) return discovered;
  }
  return adapter.models ?? [];
}

export async function listAdapterModelProfiles(type: string): Promise<AdapterModelProfileDefinition[]> {
  const adapter = findActiveServerAdapter(type);
  if (!adapter) return [];
  if (adapter.listModelProfiles) {
    const discovered = await adapter.listModelProfiles();
    if (discovered.length > 0) return discovered;
  }
  return adapter.modelProfiles ?? [];
}

export function listServerAdapters(): ServerAdapterModule[] {
  return Array.from(adaptersByType.values());
}

/**
 * List adapters excluding those that are disabled in settings.
 * Used for menus and agent creation flows — disabled adapters remain
 * functional for existing agents but hidden from selection.
 */
export function listEnabledServerAdapters(): ServerAdapterModule[] {
  const disabled = getDisabledAdapterTypesFromStore();
  const disabledSet = disabled.length > 0 ? new Set(disabled) : null;
  return disabledSet
    ? Array.from(adaptersByType.values()).filter((a) => !disabledSet.has(a.type))
    : Array.from(adaptersByType.values());
}

export async function detectAdapterModel(
  type: string,
): Promise<{ model: string; provider: string; source: string; candidates?: string[] } | null> {
  const adapter = findActiveServerAdapter(type);
  if (!adapter?.detectModel) return null;
  const detected = await adapter.detectModel();
  if (!detected) return null;
  return {
    model: detected.model,
    provider: detected.provider,
    source: detected.source,
    ...(detected.candidates?.length ? { candidates: detected.candidates } : {}),
  };
}

// ---------------------------------------------------------------------------
// Override pause / resume
// ---------------------------------------------------------------------------

/**
 * Pause or resume an external override for a builtin adapter type.
 */
export function setOverridePaused(type: string, paused: boolean): boolean {
  if (!builtinFallbacks.has(type)) return false;
  const wasPaused = pausedOverrides.has(type);
  if (paused && !wasPaused) {
    pausedOverrides.add(type);
    console.log(`[nessie] Override paused for "${type}" — builtin adapter restored`);
    return true;
  }
  if (!paused && wasPaused) {
    pausedOverrides.delete(type);
    console.log(`[nessie] Override resumed for "${type}" — external adapter active`);
    return true;
  }
  return false;
}

/** Check whether the external override for a builtin type is currently paused. */
export function isOverridePaused(type: string): boolean {
  return pausedOverrides.has(type);
}

/** Get the set of types whose overrides are currently paused. */
export function getPausedOverrides(): Set<string> {
  return pausedOverrides;
}

export function findServerAdapter(type: string): ServerAdapterModule | null {
  return adaptersByType.get(type) ?? null;
}

export function findActiveServerAdapter(type: string): ServerAdapterModule | null {
  if (pausedOverrides.has(type)) {
    const fallback = builtinFallbacks.get(type);
    if (fallback) return fallback;
  }
  return adaptersByType.get(type) ?? null;
}

// AdapterModel imported but no longer referenced after the registry was
// narrowed (acpx-local was the only consumer of dedupeAdapterModels).
// Keeping the type import for future per-adapter helpers.
export type { AdapterModel };
