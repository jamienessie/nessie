import type { Db } from "@nessie/db";
import { pickCredential, resolveSecret } from "./credentials.js";
import { resolveTosAwareness, tosAllowsAutomatedT1 } from "./tos-dial.js";
import type {
  CredentialView,
  ProviderTarget,
  Tier,
} from "./types.js";

// Resolve the desired tier from the inbound request.
//
// Order of precedence:
//   1. X-Nessie-Tier header (literal "T1"|"T2"|"T3")
//   2. Model alias prefix on the request body's `model` field
//        ("t1:claude-sonnet" -> T1, "t2:gpt-4o" -> T2, "t3:llama-..." -> T3)
//   3. Default: T3 (cheapest fallback) — agents that need quality must say so.

export function resolveRequestedTier(input: {
  headerTier?: string | null;
  modelAlias?: string | null;
}): Tier {
  const headerNormalized = input.headerTier?.trim().toUpperCase();
  if (headerNormalized === "T1" || headerNormalized === "T2" || headerNormalized === "T3") {
    return headerNormalized;
  }

  const modelLower = input.modelAlias?.trim().toLowerCase() ?? "";
  if (modelLower.startsWith("t1:")) return "T1";
  if (modelLower.startsWith("t2:")) return "T2";
  if (modelLower.startsWith("t3:")) return "T3";

  return "T3";
}

// Strip a tier prefix from a model alias, returning the underlying model id
// the upstream provider expects. "t3:llama-3.1-70b" -> "llama-3.1-70b".
export function stripTierPrefix(model: string): string {
  const lower = model.toLowerCase();
  if (lower.startsWith("t1:") || lower.startsWith("t2:") || lower.startsWith("t3:")) {
    return model.slice(3);
  }
  return model;
}

// Pick a credential for the requested tier, applying the TOS dial for T1.
// Returns null if no credential is eligible (caller returns 503 or falls
// back to the next tier — the latter is opt-in by the agent, not automatic).

export type PickProviderInput = {
  tier: Tier;
  modelAlias?: string | null;
  // If true, the call is operator-initiated (e.g. clicked "use subscription"
  // in the UI) and bypasses Conservative-mode T1 gating.
  operatorTriggered?: boolean;
  env?: NodeJS.ProcessEnv;
  // Quota Watchdog: when an upstream call returns 429 the proxy retries
  // with a sibling credential. Pass the set of already-tried credential
  // ids so the same credential isn't picked again.
  excludeCredentialIds?: string[];
};

export type PickProviderResult =
  | { ok: true; target: ProviderTarget; secret: string }
  | { ok: false; reason: PickProviderError; tier: Tier; message?: string };

export type PickProviderError =
  | "no_credential"
  | "credential_no_secret"
  | "tos_blocked";

export async function pickProvider(
  db: Db,
  input: PickProviderInput,
): Promise<PickProviderResult> {
  const env = input.env ?? process.env;

  if (input.tier === "T1") {
    const dial = resolveTosAwareness(env);
    if (!input.operatorTriggered && !tosAllowsAutomatedT1(dial)) {
      return {
        ok: false,
        reason: "tos_blocked",
        tier: input.tier,
        message: `TOS dial '${dial}' blocks automated T1 calls. Set NESSIE_TOS_AWARENESS or click the run as operator-initiated.`,
      };
    }
  }

  const credential = await pickCredential(db, input.tier, {
    excludeCredentialIds: input.excludeCredentialIds,
  });
  if (!credential) {
    return { ok: false, reason: "no_credential", tier: input.tier };
  }

  const secret = resolveSecret(credential, env);
  if (!secret) {
    return {
      ok: false,
      reason: "credential_no_secret",
      tier: input.tier,
      message: `Credential '${credential.displayName}' has secretRef='${credential.secretRef}' but no value resolved.`,
    };
  }

  return {
    ok: true,
    target: {
      credential,
      upstreamUrl: upstreamUrlFor(credential),
      upstreamModel: stripTierPrefix(input.modelAlias ?? ""),
    },
    secret,
  };
}

// Map provider name to the OpenAI-compatible endpoint URL the proxy forwards
// to. Phase 0 supports the OpenAI-shape providers directly. Anthropic /
// Bedrock / Vertex translation lives in Phase 1 with their adapters.
function upstreamUrlFor(credential: CredentialView): string {
  switch (credential.provider) {
    case "openai":
      return "https://api.openai.com/v1";
    case "openrouter":
      return "https://openrouter.ai/api/v1";
    case "fireworks":
      return "https://api.fireworks.ai/inference/v1";
    case "groq":
      return "https://api.groq.com/openai/v1";
    case "azure":
      // Azure URLs are deployment-scoped; v1 reads NESSIE_AZURE_ENDPOINT.
      return process.env.NESSIE_AZURE_ENDPOINT?.trim() ?? "";
    case "anthropic":
    case "bedrock":
    case "vertex":
      // Translation handled by per-provider adapters in Phase 1.
      return "";
    default:
      return "";
  }
}
