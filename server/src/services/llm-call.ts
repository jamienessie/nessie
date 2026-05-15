// Shared LLM helper for control-plane features.
//
// The Nessie cost-tier proxy on 127.0.0.1:7777 is the canonical synchronous
// LLM entry point — it routes the request to a tier-appropriate credential
// pool, forwards to the upstream provider, and records the cost event. This
// helper wraps it for the features that need real AI replies (Red/Blue
// debate, Voice mode, Sleep Mode dreams, Company Generator, etc.).
//
// Behaviour:
//  - Defaults to the operator-triggered header, since these features only
//    fire when a board user explicitly clicks something in the UI.
//  - Surfaces credential / TOS failures through a typed `LlmUnavailable`
//    result so the route handlers can return a UI-friendly error explaining
//    exactly what the user needs to configure.
//  - Returns the assistant's reply text, the raw response, and the tier
//    that actually ran the call.

export type LlmMessage = { role: "system" | "user" | "assistant"; content: string };

export type LlmCallInput = {
  companyId: string;
  /** Preferred tier order. Helper tries each until one succeeds. Defaults to T1 → T2 → T3. */
  tiers?: ("T1" | "T2" | "T3")[];
  /** Optional model alias override. Defaults to a sensible per-tier choice. */
  model?: string | null;
  messages: LlmMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Override the agent header (defaults to "nessie-control-plane"). */
  agentId?: string | null;
};

export type LlmReply = {
  ok: true;
  text: string;
  tier: "T1" | "T2" | "T3";
  model: string;
  usage: Record<string, unknown> | null;
};

export type LlmUnavailable = {
  ok: false;
  reason: "no_credential" | "tos_blocked" | "upstream_error" | "proxy_unreachable";
  triedTiers: ("T1" | "T2" | "T3")[];
  message: string;
  /** Concrete fix to surface in the UI ("Add a T2 credential in Settings → Credentials" etc). */
  fix: string;
};

const DEFAULT_TIER_ORDER: ("T1" | "T2" | "T3")[] = ["T1", "T2", "T3"];
const DEFAULT_MODEL_BY_TIER: Record<"T1" | "T2" | "T3", string> = {
  T1: "t1:claude-sonnet",
  T2: "t2:gpt-4o-mini",
  T3: "t3:llama-3.1-70b",
};

const PROXY_BASE = process.env.PAPERCLIP_PROXY_URL?.trim() || "http://127.0.0.1:7777";

interface ProxyError {
  error?: { type?: string; message?: string };
}

function isProxyError(value: unknown): value is ProxyError {
  return typeof value === "object" && value !== null && "error" in (value as Record<string, unknown>);
}

async function tryOnce(input: {
  tier: "T1" | "T2" | "T3";
  model: string;
  body: Record<string, unknown>;
  companyId: string;
  agentId: string | null;
}): Promise<
  | { kind: "ok"; text: string; usage: Record<string, unknown> | null }
  | { kind: "err"; reason: LlmUnavailable["reason"]; message: string }
> {
  let res: Response;
  try {
    res = await fetch(`${PROXY_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-nessie-tier": input.tier,
        "x-nessie-company": input.companyId,
        "x-nessie-agent": input.agentId ?? "nessie-control-plane",
        "x-nessie-operator-triggered": "true",
      },
      body: JSON.stringify(input.body),
    });
  } catch (err) {
    return {
      kind: "err",
      reason: "proxy_unreachable",
      message: err instanceof Error ? err.message : "proxy unreachable",
    };
  }

  const raw = await res.text();
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch {
    return { kind: "err", reason: "upstream_error", message: `proxy returned non-JSON (${res.status})` };
  }

  if (!res.ok || isProxyError(parsed)) {
    const errorType = isProxyError(parsed) ? parsed.error?.type ?? "upstream_error" : "upstream_error";
    const errorMessage = isProxyError(parsed) ? parsed.error?.message ?? "" : "";
    if (errorType === "no_credential") {
      return { kind: "err", reason: "no_credential", message: errorMessage || `no ${input.tier} credential` };
    }
    if (errorType === "tos_blocked") {
      return { kind: "err", reason: "tos_blocked", message: errorMessage || `${input.tier} blocked by TOS dial` };
    }
    return { kind: "err", reason: "upstream_error", message: errorMessage || `${res.status}` };
  }

  const reply = parsed as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: Record<string, unknown>;
  };
  const text = reply.choices?.[0]?.message?.content ?? "";
  return { kind: "ok", text, usage: reply.usage ?? null };
}

export async function callNessieProxy(input: LlmCallInput): Promise<LlmReply | LlmUnavailable> {
  const tiers = input.tiers ?? DEFAULT_TIER_ORDER;
  const tried: ("T1" | "T2" | "T3")[] = [];
  let lastErr: { reason: LlmUnavailable["reason"]; message: string } | null = null;

  for (const tier of tiers) {
    tried.push(tier);
    const model = input.model ?? DEFAULT_MODEL_BY_TIER[tier];
    const body: Record<string, unknown> = {
      model,
      messages: input.messages,
      stream: false,
    };
    if (typeof input.temperature === "number") body.temperature = input.temperature;
    if (typeof input.maxTokens === "number") body.max_tokens = input.maxTokens;

    const result = await tryOnce({
      tier,
      model,
      body,
      companyId: input.companyId,
      agentId: input.agentId ?? null,
    });

    if (result.kind === "ok" && result.text) {
      return {
        ok: true,
        text: result.text.trim(),
        tier,
        model,
        usage: result.usage,
      };
    }
    if (result.kind === "err") {
      lastErr = { reason: result.reason, message: result.message };
      // proxy_unreachable means the proxy isn't running — no point trying more tiers
      if (result.reason === "proxy_unreachable") break;
    }
  }

  const reason = lastErr?.reason ?? "no_credential";
  const fix =
    reason === "no_credential"
      ? `Configure at least one credential in Settings → Credentials (any of ${tried.join(", ")}).`
      : reason === "tos_blocked"
      ? `Set NESSIE_TOS_AWARENESS=Permissive (or add a T2/T3 credential) to unlock subscription-based calls.`
      : reason === "proxy_unreachable"
      ? `Cost-tier proxy isn't running at ${PROXY_BASE}. Restart the dev server.`
      : `Upstream provider error. Check Settings → Credentials.`;

  return {
    ok: false,
    reason,
    triedTiers: tried,
    message: lastErr?.message ?? "no LLM available",
    fix,
  };
}
