/**
 * Adapter types shipped with Nessie. External plugins must not replace these.
 *
 * Phase 1 v1 catalog:
 *   - claude_local       — Claude Code CLI (T1 subscription)
 *   - codex_local        — Codex CLI (T1 subscription)
 *   - opencode_local     — OpenCode CLI (local provider-router)
 *   - windsurf_local     — Windsurf SWE via Devin for Terminal (ACP)
 *   - openai_compatible  — workhorse for T2/T3 via the cost-tier proxy
 *   - openrouter_compatible — remote OpenRouter catalog with live discovery
 *   - gemini_compatible  — Google Gemini API, free-tier filter
 *   - azure_openai       — Azure OpenAI Service with live deployment discovery (T2)
 *   - http_webhook       — external automations / human-in-the-loop
 *   - process / http     — adapter-plugin transports (always available)
 *
 * Legacy types (acpx_local / cursor / gemini_local / openclaw_gateway /
 * pi_local / hermes_local) are intentionally absent. Their packages remain
 * on disk as workspace dependencies but are no longer registered.
 */
export const BUILTIN_ADAPTER_TYPES = new Set([
  "claude_local",
  "codex_local",
  "opencode_local",
  "windsurf_local",
  "openai_compatible",
  "openrouter_compatible",
  "gemini_compatible",
  "azure_openai",
  "http_webhook",
  "process",
  "http",
]);
