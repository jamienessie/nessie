import { type Express, type Request, type Response, type NextFunction, default as express } from "express";
import type { Db } from "@nessie/db";
import { pickProvider, resolveRequestedTier, stripTierPrefix } from "./router.js";
import { recordCost } from "./cost-meter.js";
import { resolveTosAwareness } from "./tos-dial.js";
import {
  NESSIE_AGENT_HEADER,
  NESSIE_COMPANY_HEADER,
  NESSIE_HEARTBEAT_HEADER,
  NESSIE_TIER_HEADER,
} from "./types.js";

// Nessie cost-tier proxy.
//
// Listens on 127.0.0.1:7777 and speaks the OpenAI Chat Completions wire
// shape. Reads X-Nessie-Tier (or a t1:/t2:/t3: model alias) to pick a
// credential pool, forwards the request to the upstream provider, writes
// a cost_events row from the response usage block, and pipes the response
// back to the caller.
//
// Phase 0 scope: OpenAI-compatible upstreams only (openai, openrouter,
// fireworks, groq, azure). Anthropic / Bedrock / Vertex translation lives
// in Phase 1 with their adapters.

export type ProxyHandle = {
  app: Express;
  close: () => Promise<void>;
};

export type CreateProxyInput = {
  db: Db;
  port?: number;
  host?: string;
};

export const NESSIE_PROXY_DEFAULT_PORT = 7777;
export const NESSIE_PROXY_DEFAULT_HOST = "127.0.0.1";

export async function startNessieProxy(input: CreateProxyInput): Promise<ProxyHandle> {
  const app = express();
  app.use(express.json({ limit: "16mb" }));

  // Health probe for the proxy itself.
  app.get("/v1/health", (_req, res) => {
    res.json({ status: "ok", tosAwareness: resolveTosAwareness() });
  });

  // Tier-aware /v1/models. Returns a flat list of "tN:<model>" aliases the
  // operator's adapters can target, plus the pass-through models if the
  // caller is asking for an OpenAI listing directly.
  app.get("/v1/models", (_req, res) => {
    res.json({
      object: "list",
      data: [
        // T1 placeholders. Real models populate from credentials in Phase 1.
        { id: "t1:claude-sonnet", object: "model", owned_by: "nessie", tier: "T1" },
        { id: "t1:gpt-4o", object: "model", owned_by: "nessie", tier: "T1" },
        // T2 paid-API workhorses.
        { id: "t2:claude-3-5-sonnet", object: "model", owned_by: "nessie", tier: "T2" },
        { id: "t2:gpt-4o", object: "model", owned_by: "nessie", tier: "T2" },
        { id: "t2:gpt-4o-mini", object: "model", owned_by: "nessie", tier: "T2" },
        // T3 cheap / free.
        { id: "t3:llama-3.1-70b", object: "model", owned_by: "nessie", tier: "T3" },
        { id: "t3:llama-3.1-8b", object: "model", owned_by: "nessie", tier: "T3" },
        { id: "t3:mixtral-8x7b", object: "model", owned_by: "nessie", tier: "T3" },
      ],
    });
  });

  // Anthropic /v1/messages — Phase 1 implements the translation layer.
  app.post("/v1/messages", (_req, res) => {
    res.status(501).json({
      error: { message: "Anthropic /v1/messages translation lands in Phase 1.", type: "not_implemented" },
    });
  });

  app.post("/v1/chat/completions", (req, res, next) => {
    void handleChatCompletion(input.db, req, res).catch(next);
  });

  // Last-resort error handler.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: { message, type: "proxy_internal_error" } });
  });

  const host = input.host ?? NESSIE_PROXY_DEFAULT_HOST;
  const port = input.port ?? NESSIE_PROXY_DEFAULT_PORT;
  const server = app.listen(port, host);

  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
  });

  return {
    app,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function handleChatCompletion(db: Db, req: Request, res: Response): Promise<void> {
  const body = req.body as { model?: string; stream?: boolean } & Record<string, unknown>;

  const tier = resolveRequestedTier({
    headerTier: req.header(NESSIE_TIER_HEADER) ?? null,
    modelAlias: body?.model ?? null,
  });

  const operatorTriggered = req.header("x-nessie-operator-triggered")?.toLowerCase() === "true";

  const pick = await pickProvider(db, {
    tier,
    modelAlias: body?.model ?? null,
    operatorTriggered,
  });

  if (!pick.ok) {
    const status = pick.reason === "tos_blocked" ? 451 : 503;
    res.status(status).json({
      error: {
        type: pick.reason,
        tier: pick.tier,
        message: pick.message ?? `No ${pick.tier} credential available.`,
      },
    });
    return;
  }

  const { target, secret } = pick;
  const upstreamModel = target.upstreamModel || stripTierPrefix(body.model ?? "");
  if (!target.upstreamUrl) {
    res.status(501).json({
      error: {
        type: "provider_not_supported_in_phase_0",
        provider: target.credential.provider,
        message: `Provider '${target.credential.provider}' needs the per-provider adapter in Phase 1.`,
      },
    });
    return;
  }

  // Forward to upstream (OpenAI-compatible only in Phase 0). Streaming is
  // accepted but currently buffered; SSE pass-through lands with the
  // openai-compatible adapter.
  const upstreamBody = { ...body, model: upstreamModel };
  if (body.stream) upstreamBody.stream = false;

  const upstreamRes = await fetch(`${target.upstreamUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(upstreamBody),
  });

  const text = await upstreamRes.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    res.status(502).json({
      error: {
        type: "upstream_non_json",
        message: `Upstream ${target.credential.provider} returned non-JSON (HTTP ${upstreamRes.status}).`,
      },
    });
    return;
  }

  const usage = (parsed as { usage?: { prompt_tokens?: number; completion_tokens?: number; cached_input_tokens?: number } })?.usage;

  await recordCost(db, {
    credential: target.credential,
    tier,
    model: upstreamModel,
    usage,
    agentId: req.header(NESSIE_AGENT_HEADER) ?? null,
    companyId: req.header(NESSIE_COMPANY_HEADER) ?? null,
    heartbeatRunId: req.header(NESSIE_HEARTBEAT_HEADER) ?? null,
  });

  res.status(upstreamRes.status).json(parsed);
}
