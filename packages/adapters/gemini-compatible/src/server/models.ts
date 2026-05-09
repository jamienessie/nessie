import { createHash } from "node:crypto";
import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterModel,
} from "@nessie/adapter-utils";

// Gemini API base + endpoints. The native models endpoint is at
// /v1beta/models; the OpenAI-compat chat endpoint we use for execution
// is at /v1beta/openai/chat/completions. We keep one base URL covering
// both, then append the suffix at call sites.
export const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const MODELS_CACHE_TTL_MS = 60_000;
const MODELS_DISCOVERY_TIMEOUT_MS = 20_000;

// Free-tier filter. The Gemini API doesn't expose a price/tier field on
// /v1beta/models, so we whitelist by name pattern. The Flash family has
// a generous free tier on Google AI Studio; the Pro/Ultra families are
// paid (or have a tiny free quota that we don't want to surface as
// "free"). Image, vision, and native-audio variants are excluded too —
// the chat-completions code path can't drive them anyway.
const FREE_INCLUDE_TOKENS = ["flash"];
const FREE_EXCLUDE_TOKENS = [
  "pro",
  "ultra",
  "vision",
  "image",
  "audio",
  "embedding",
  "tts",
  "live",
];

type GeminiModelRecord = {
  name?: unknown;
  displayName?: unknown;
  supportedGenerationMethods?: unknown;
};

type GeminiModelsResponse = {
  models?: unknown;
};

const discoveryCache = new Map<string, { expiresAt: number; models: AdapterModel[] }>();

function readNonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readApiKey(raw: unknown): string | null {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const apiKey = readNonEmptyString((raw as Record<string, unknown>).apiKey);
    if (apiKey) return apiKey;
    // Allow the key to live inside a nested env binding, parallel to how
    // other adapters surface secrets.
    const env = (raw as Record<string, unknown>).env;
    if (env && typeof env === "object" && !Array.isArray(env)) {
      const envRec = env as Record<string, unknown>;
      const direct = readNonEmptyString(envRec.GEMINI_API_KEY)
        ?? readNonEmptyString(envRec.GOOGLE_API_KEY);
      if (direct) return direct;
    }
  }
  return readNonEmptyString(process.env.GEMINI_API_KEY)
    ?? readNonEmptyString(process.env.GOOGLE_API_KEY);
}

function readBaseUrl(raw: unknown): string {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const baseUrl = readNonEmptyString((raw as Record<string, unknown>).baseUrl);
    if (baseUrl) return baseUrl.replace(/\/+$/, "");
  }
  const envBaseUrl = readNonEmptyString(process.env.GEMINI_BASE_URL);
  return (envBaseUrl ?? DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, "");
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function discoveryCacheKey(baseUrl: string, apiKey: string) {
  return `${baseUrl}\n${hashValue(apiKey)}`;
}

function pruneExpiredDiscoveryCache(now: number) {
  for (const [key, value] of discoveryCache.entries()) {
    if (value.expiresAt <= now) discoveryCache.delete(key);
  }
}

// `name` from the API is "models/gemini-2.0-flash"; strip the prefix to
// get the model id used at call time.
function stripModelsPrefix(name: string): string {
  return name.startsWith("models/") ? name.slice("models/".length) : name;
}

export function isFreeTierGeminiModel(modelId: string): boolean {
  const id = modelId.toLowerCase();
  if (!FREE_INCLUDE_TOKENS.some((token) => id.includes(token))) return false;
  if (FREE_EXCLUDE_TOKENS.some((token) => id.includes(token))) return false;
  return true;
}

function supportsChatCompletion(record: GeminiModelRecord): boolean {
  const methods = record.supportedGenerationMethods;
  if (!Array.isArray(methods)) return false;
  return methods.some((m) => typeof m === "string" && m.toLowerCase() === "generatecontent");
}

function mapGeminiModel(record: unknown): AdapterModel | null {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return null;
  const m = record as GeminiModelRecord;
  const rawName = readNonEmptyString(m.name);
  if (!rawName) return null;
  const id = stripModelsPrefix(rawName);
  if (!id) return null;
  if (!supportsChatCompletion(m)) return null;
  if (!isFreeTierGeminiModel(id)) return null;
  const label = readNonEmptyString(m.displayName) ?? id;
  return { id, label };
}

export function parseGeminiModelsResponse(payload: unknown): AdapterModel[] {
  const models = typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as GeminiModelsResponse).models
    : null;
  if (!Array.isArray(models)) return [];
  return models.flatMap((entry) => {
    const mapped = mapGeminiModel(entry);
    return mapped ? [mapped] : [];
  });
}

function dedupeModels(models: AdapterModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const deduped: AdapterModel[] = [];
  for (const model of models) {
    const id = model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push({ id, label: model.label.trim() || id });
  }
  return deduped;
}

export function sortGeminiModels(models: AdapterModel[]): AdapterModel[] {
  // Stable sort by displayName, then by id. Newer models tend to sort
  // first because labels usually start with the version number.
  return [...models].sort((a, b) => {
    const labelCompare = a.label.localeCompare(b.label, "en", {
      numeric: true,
      sensitivity: "base",
    });
    if (labelCompare !== 0) return labelCompare;
    return a.id.localeCompare(b.id, "en", {
      numeric: true,
      sensitivity: "base",
    });
  });
}

async function fetchGeminiModels(input: {
  baseUrl: string;
  apiKey: string;
}): Promise<AdapterModel[]> {
  const url = `${input.baseUrl}/models?key=${encodeURIComponent(input.apiKey)}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(MODELS_DISCOVERY_TIMEOUT_MS),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    let detail = "";
    try {
      const parsed = JSON.parse(bodyText) as { error?: { message?: unknown; status?: unknown } };
      detail = readNonEmptyString(parsed.error?.message)
        ?? readNonEmptyString(parsed.error?.status)
        ?? "";
    } catch {
      detail = readNonEmptyString(bodyText) ?? "";
    }
    throw new Error(
      detail
        ? `Gemini model discovery failed with HTTP ${response.status}: ${detail}`
        : `Gemini model discovery failed with HTTP ${response.status}.`,
    );
  }

  const payload = await response.json();
  return sortGeminiModels(dedupeModels(parseGeminiModelsResponse(payload)));
}

function cacheModels(cacheKey: string, models: AdapterModel[]) {
  discoveryCache.set(cacheKey, {
    expiresAt: Date.now() + MODELS_CACHE_TTL_MS,
    models,
  });
}

export async function discoverGeminiModels(input: {
  baseUrl?: unknown;
  apiKey?: unknown;
} = {}): Promise<AdapterModel[]> {
  const apiKey = readApiKey(input.apiKey ?? input);
  if (!apiKey) {
    throw new Error("Gemini API key is missing. Set GEMINI_API_KEY (or GOOGLE_API_KEY).");
  }
  const baseUrl = readBaseUrl(input.baseUrl ?? input);
  return fetchGeminiModels({ baseUrl, apiKey });
}

export async function discoverGeminiModelsCached(input: {
  baseUrl?: unknown;
  apiKey?: unknown;
} = {}): Promise<AdapterModel[]> {
  const apiKey = readApiKey(input.apiKey ?? input);
  if (!apiKey) {
    throw new Error("Gemini API key is missing. Set GEMINI_API_KEY (or GOOGLE_API_KEY).");
  }
  const baseUrl = readBaseUrl(input.baseUrl ?? input);
  const key = discoveryCacheKey(baseUrl, apiKey);
  const now = Date.now();
  pruneExpiredDiscoveryCache(now);
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > now) return cached.models;

  const models = await fetchGeminiModels({ baseUrl, apiKey });
  cacheModels(key, models);
  return models;
}

export async function listGeminiModels(): Promise<AdapterModel[]> {
  return discoverGeminiModelsCached();
}

export async function refreshGeminiModels(): Promise<AdapterModel[]> {
  discoveryCache.clear();
  return discoverGeminiModelsCached();
}

export function requireGeminiModelId(input: unknown): string {
  const model = readNonEmptyString(input);
  if (!model) {
    throw new Error("Gemini adapter requires `model` on adapterConfig");
  }
  return model;
}

function failResult(code: string, message: string): AdapterEnvironmentTestResult {
  return {
    adapterType: "gemini_compatible",
    status: "fail",
    checks: [{ code, level: "error", message }],
    testedAt: new Date().toISOString(),
  };
}

export async function testGeminiEnvironment(
  ctx: AdapterEnvironmentTestContext & { config: Record<string, unknown> },
): Promise<AdapterEnvironmentTestResult> {
  const apiKey = readApiKey(ctx.config);
  if (!apiKey) {
    return failResult(
      "gemini_api_key_missing",
      "Gemini API key is missing. Set GEMINI_API_KEY (or GOOGLE_API_KEY) on the agent or host environment.",
    );
  }

  const baseUrl = readBaseUrl(ctx.config);
  try {
    const models = await fetchGeminiModels({ baseUrl, apiKey });
    if (models.length === 0) {
      return {
        adapterType: "gemini_compatible",
        status: "warn",
        checks: [
          {
            code: "gemini_no_free_models",
            level: "warn",
            message: `Gemini API reachable at ${baseUrl}, but no free-tier text models were returned. The free-tier filter excludes pro/ultra/vision/image/audio/embedding variants.`,
          },
        ],
        testedAt: new Date().toISOString(),
      };
    }

    return {
      adapterType: "gemini_compatible",
      status: "pass",
      checks: [
        {
          code: "gemini_models_reachable",
          level: "info",
          message: `Gemini models endpoint reachable at ${baseUrl} (${models.length} free-tier model${models.length === 1 ? "" : "s"} discovered).`,
        },
      ],
      testedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failResult("gemini_model_discovery_failed", message);
  }
}

export function resetGeminiModelsCacheForTests() {
  discoveryCache.clear();
}
