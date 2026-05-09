/**
 * Adapter types shipped with Nessie. External plugins must not replace these.
 *
 * Phase 1 v1 catalog (per the plan):
 *   - claude_local       — Claude Code CLI (T1 subscription)
 *   - codex_local        — Codex CLI (T1 subscription)
 *   - openai_compatible  — workhorse for T2/T3 via the cost-tier proxy
 *   - openrouter_compatible — remote OpenRouter catalog with live discovery
 *   - http_webhook       — external automations / human-in-the-loop
 *   - process / http     — adapter-plugin transports (always available)
 *
 * Six legacy types (acpx_local / cursor / gemini_local / openclaw_gateway /
 * opencode_local / pi_local / hermes_local) are intentionally absent. Their
 * packages remain on disk as workspace dependencies but are no longer
 * registered. They can be brought back later via the plugin system.
 */
export const BUILTIN_ADAPTER_TYPES = new Set([
  "claude_local",
  "codex_local",
  "openai_compatible",
  "openrouter_compatible",
  "http_webhook",
  "process",
  "http",
]);
