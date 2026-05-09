import { createHash } from "node:crypto";
import type { AdapterEnvironmentTestContext, AdapterEnvironmentTestResult, AdapterModel } from "@nessie/adapter-utils";

export const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const MODELS_CACHE_TTL_MS = 60_000;
const MODELS_DISCOVERY_TIMEOUT_MS = 20_000;
const OPENROUTER_MODEL_FREE_SUFFIX = ":free";
const OPENROUTER_MODEL_PRICING_FIELDS = [
  "prompt",
  "completion",
  "request",
  "image",
  "web_search",
  "internal_reasoning",
  "input_cache_read",
  "input_cache_write",
] as const;

type OpenRouterModelRecord = {
  id?: unknown;
  name?: unknown;
  pricing?: unknown;
};

type OpenRouterModelsResponse = {
  data?: unknown;
};

type OpenRouterParsedModel = {
  model: AdapterModel;
  free: boolean;
};

const discoveryCache = new Map<string, { expiresAt: number; models: AdapterModel[] }>();

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readNonEmptyString(value: unknown): string | null {
  const text = readString(value);
  return text.length > 0 ? text : null;
}

function readApiKeyFromConfigOrEnv(raw: unknown): string | null {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const apiKey = readNonEmptyString((raw as Record<string, unknown>).apiKey);
    if (apiKey) return apiKey;
  }
  return readNonEmptyString(process.env.OPENROUTER_API_KEY);
}

function readBaseUrlFromConfigOrEnv(raw: unknown): string {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const baseUrl = readNonEmptyString((raw as Record<string, unknown>).baseUrl);
    if (baseUrl) return baseUrl.replace(/\/+$/, "");
  }
  const envBaseUrl = readNonEmptyString(process.env.OPENROUTER_BASE_URL);
  return (envBaseUrl ?? DEFAULT_OPENROUTER_BASE_URL).replace(/\/+$/, "");
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

function parseNumericPricingValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function isFreePricing(pricing: unknown): boolean {
  if (typeof pricing !== "object" || pricing === null || Array.isArray(pricing)) return false;
  const record = pricing as Record<string, unknown>;
  let sawKnownField = false;
  for (const field of OPENROUTER_MODEL_PRICING_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) continue;
    sawKnownField = true;
    if (parseNumericPricingValue(record[field]) !== 0) {
      return false;
    }
  }
  return sawKnownField;
}

function isFreeModel(record: OpenRouterModelRecord): boolean {
  const id = readNonEmptyString(record.id) ?? "";
  if (id.endsWith(OPENROUTER_MODEL_FREE_SUFFIX)) return true;
  return isFreePricing(record.pricing);
}

function mapOpenRouterModel(record: unknown): OpenRouterParsedModel | null {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return null;
  const modelRecord = record as OpenRouterModelRecord;
  const id = readNonEmptyString(modelRecord.id);
  if (!id) return null;
  const label = readNonEmptyString(modelRecord.name) ?? id;
  return {
    model: { id, label },
    free: isFreeModel(modelRecord),
  };
}

export function parseOpenRouterModelsResponse(payload: unknown): OpenRouterParsedModel[] {
  const data = typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as OpenRouterModelsResponse).data
    : null;
  if (!Array.isArray(data)) return [];
  return data.flatMap((entry) => {
    const mapped = mapOpenRouterModel(entry);
    return mapped ? [mapped] : [];
  });
}

function dedupeParsedModels(models: OpenRouterParsedModel[]): OpenRouterParsedModel[] {
  const seen = new Set<string>();
  const deduped: OpenRouterParsedModel[] = [];
  for (const entry of models) {
    const id = entry.model.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    deduped.push({
      free: entry.free,
      model: { id, label: entry.model.label.trim() || id },
    });
  }
  return deduped;
}

export function sortOpenRouterModels(models: OpenRouterParsedModel[]): AdapterModel[] {
  const seen = new Set<string>();
  const unique = models.filter((entry) => {
    const id = entry.model.id.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  return [...unique]
    .sort((a, b) => {
      if (a.free !== b.free) return a.free ? -1 : 1;
      const labelCompare = a.model.label.localeCompare(b.model.label, "en", {
        numeric: true,
        sensitivity: "base",
      });
      if (labelCompare !== 0) return labelCompare;
      return a.model.id.localeCompare(b.model.id, "en", {
        numeric: true,
        sensitivity: "base",
      });
    })
    .map((entry) => entry.model);
}

function buildOpenRouterHeaders(apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
  };
  const referer = readNonEmptyString(process.env.OPENROUTER_HTTP_REFERER);
  if (referer) headers["HTTP-Referer"] = referer;
  const title =
    readNonEmptyString(process.env.OPENROUTER_X_TITLE)
    ?? readNonEmptyString(process.env.OPENROUTER_TITLE);
  if (title) headers["X-OpenRouter-Title"] = title;
  return headers;
}

async function fetchOpenRouterModels(input: {
  baseUrl: string;
  apiKey: string;
}): Promise<AdapterModel[]> {
  const response = await fetch(`${input.baseUrl}/models?output_modalities=text`, {
    headers: buildOpenRouterHeaders(input.apiKey),
    signal: AbortSignal.timeout(MODELS_DISCOVERY_TIMEOUT_MS),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    let detail = "";
    try {
      const parsed = JSON.parse(bodyText) as { error?: { message?: unknown; type?: unknown } };
      const message = readNonEmptyString(parsed.error?.message);
      const type = readNonEmptyString(parsed.error?.type);
      detail = message ?? type ?? "";
    } catch {
      detail = readNonEmptyString(bodyText) ?? "";
    }
    throw new Error(
      detail
        ? `OpenRouter model discovery failed with HTTP ${response.status}: ${detail}`
        : `OpenRouter model discovery failed with HTTP ${response.status}.`,
    );
  }

  const payload = (await response.json()) as OpenRouterModelsResponse;
  const parsed = dedupeParsedModels(parseOpenRouterModelsResponse(payload));
  return sortOpenRouterModels(parsed);
}

function cacheModels(cacheKey: string, models: AdapterModel[]) {
  discoveryCache.set(cacheKey, {
    expiresAt: Date.now() + MODELS_CACHE_TTL_MS,
    models,
  });
}

export async function discoverOpenRouterModels(input: {
  baseUrl?: unknown;
  apiKey?: unknown;
} = {}): Promise<AdapterModel[]> {
  const apiKey = readApiKeyFromConfigOrEnv(input.apiKey);
  if (!apiKey) {
    throw new Error("OpenRouter API key is missing. Set OPENROUTER_API_KEY.");
  }
  const baseUrl = readBaseUrlFromConfigOrEnv(input.baseUrl);
  return fetchOpenRouterModels({ baseUrl, apiKey });
}

export async function discoverOpenRouterModelsCached(input: {
  baseUrl?: unknown;
  apiKey?: unknown;
} = {}): Promise<AdapterModel[]> {
  const apiKey = readApiKeyFromConfigOrEnv(input.apiKey);
  if (!apiKey) {
    throw new Error("OpenRouter API key is missing. Set OPENROUTER_API_KEY.");
  }
  const baseUrl = readBaseUrlFromConfigOrEnv(input.baseUrl);
  const key = discoveryCacheKey(baseUrl, apiKey);
  const now = Date.now();
  pruneExpiredDiscoveryCache(now);
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > now) return cached.models;

  const models = await fetchOpenRouterModels({ baseUrl, apiKey });
  cacheModels(key, models);
  return models;
}

export async function listOpenRouterModels(): Promise<AdapterModel[]> {
  return discoverOpenRouterModelsCached();
}

export async function refreshOpenRouterModels(): Promise<AdapterModel[]> {
  discoveryCache.clear();
  return discoverOpenRouterModelsCached();
}

export function requireOpenRouterModelId(input: unknown): string {
  const model = readNonEmptyString(input);
  if (!model) {
    throw new Error("OpenRouter adapter requires `model` on adapterConfig");
  }
  return model;
}

function failResult(code: string, message: string): AdapterEnvironmentTestResult {
  return {
    adapterType: "openrouter_compatible",
    status: "fail",
    checks: [{ code, level: "error", message }],
    testedAt: new Date().toISOString(),
  };
}

export async function testOpenRouterEnvironment(
  ctx: AdapterEnvironmentTestContext & { config: Record<string, unknown> },
): Promise<AdapterEnvironmentTestResult> {
  const apiKey = readApiKeyFromConfigOrEnv(ctx.config);
  if (!apiKey) {
    return failResult("openrouter_api_key_missing", "OpenRouter API key is missing. Set OPENROUTER_API_KEY.");
  }

  const baseUrl = readBaseUrlFromConfigOrEnv(ctx.config);
  try {
    const models = await fetchOpenRouterModels({ baseUrl, apiKey });
    if (models.length === 0) {
      return {
        adapterType: "openrouter_compatible",
        status: "warn",
        checks: [
          {
            code: "openrouter_no_models",
            level: "warn",
            message: `OpenRouter API reachable at ${baseUrl}, but no runnable text models were returned.`,
          },
        ],
        testedAt: new Date().toISOString(),
      };
    }

    return {
      adapterType: "openrouter_compatible",
      status: "pass",
      checks: [
        {
          code: "openrouter_models_reachable",
          level: "info",
          message: `OpenRouter models endpoint reachable at ${baseUrl} (${models.length} runnable model${models.length === 1 ? "" : "s"} discovered).`,
        },
      ],
      testedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failResult("openrouter_model_discovery_failed", message);
  }
}

export function resetOpenRouterModelsCacheForTests() {
  discoveryCache.clear();
}
