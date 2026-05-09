import { createHash } from "node:crypto";
import type { AdapterEnvironmentTestContext, AdapterEnvironmentTestResult, AdapterModel } from "@nessie/adapter-utils";

export const DEFAULT_AZURE_OPENAI_API_VERSION = "2024-10-21";
export const AZURE_OPENAI_DISCOVERY_API_VERSION = "2023-05-01";
const MODELS_CACHE_TTL_MS = 60_000;
const MODELS_DISCOVERY_TIMEOUT_MS = 20_000;

type AzureDeploymentRecord = {
  id?: unknown;
  model?: unknown;
  properties?: unknown;
};

type AzureDeploymentsResponse = {
  data?: unknown;
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
  return readNonEmptyString(process.env.AZURE_OPENAI_API_KEY);
}

function readEndpointFromConfigOrEnv(raw: unknown): string | null {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const endpoint = readNonEmptyString((raw as Record<string, unknown>).endpoint);
    if (endpoint) return endpoint.replace(/\/+$/, "");
  }
  const envEndpoint = readNonEmptyString(process.env.AZURE_OPENAI_ENDPOINT);
  return envEndpoint ? envEndpoint.replace(/\/+$/, "") : null;
}

export function readApiVersionFromConfigOrEnv(raw: unknown): string {
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    const apiVersion = readNonEmptyString((raw as Record<string, unknown>).apiVersion);
    if (apiVersion) return apiVersion;
  }
  return readNonEmptyString(process.env.AZURE_OPENAI_API_VERSION) ?? DEFAULT_AZURE_OPENAI_API_VERSION;
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function discoveryCacheKey(endpoint: string, apiKey: string) {
  return `${endpoint}\n${hashValue(apiKey)}`;
}

function pruneExpiredDiscoveryCache(now: number) {
  for (const [key, value] of discoveryCache.entries()) {
    if (value.expiresAt <= now) discoveryCache.delete(key);
  }
}

function readDeploymentModel(record: AzureDeploymentRecord): string | null {
  const direct = readNonEmptyString(record.model);
  if (direct) return direct;
  const properties = record.properties;
  if (typeof properties !== "object" || properties === null || Array.isArray(properties)) return null;
  const propsRecord = properties as Record<string, unknown>;
  const modelObj = propsRecord.model;
  if (typeof modelObj === "object" && modelObj !== null && !Array.isArray(modelObj)) {
    const name = readNonEmptyString((modelObj as Record<string, unknown>).name);
    if (name) return name;
  }
  return readNonEmptyString(propsRecord.modelName);
}

export function mapAzureDeployment(record: unknown): AdapterModel | null {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return null;
  const deployment = record as AzureDeploymentRecord;
  const id = readNonEmptyString(deployment.id);
  if (!id) return null;
  const model = readDeploymentModel(deployment);
  const label = model && model !== id ? `${id} (${model})` : id;
  return { id, label };
}

export function parseAzureDeploymentsResponse(payload: unknown): AdapterModel[] {
  const data = typeof payload === "object" && payload !== null && !Array.isArray(payload)
    ? (payload as AzureDeploymentsResponse).data
    : null;
  if (!Array.isArray(data)) return [];
  const seen = new Set<string>();
  const result: AdapterModel[] = [];
  for (const entry of data) {
    const mapped = mapAzureDeployment(entry);
    if (!mapped) continue;
    if (seen.has(mapped.id)) continue;
    seen.add(mapped.id);
    result.push(mapped);
  }
  return result;
}

export function sortAzureDeployments(models: AdapterModel[]): AdapterModel[] {
  return [...models].sort((a, b) =>
    a.label.localeCompare(b.label, "en", { numeric: true, sensitivity: "base" })
    || a.id.localeCompare(b.id, "en", { numeric: true, sensitivity: "base" }),
  );
}

function buildAzureHeaders(apiKey: string): Record<string, string> {
  return {
    "api-key": apiKey,
  };
}

type AzureDiscoveryFetchResult =
  | { kind: "models"; models: AdapterModel[] }
  | { kind: "unsupported"; status: number };

async function fetchAzureDeploymentsRaw(input: {
  endpoint: string;
  apiKey: string;
}): Promise<AzureDiscoveryFetchResult> {
  const url = `${input.endpoint}/openai/deployments?api-version=${AZURE_OPENAI_DISCOVERY_API_VERSION}`;
  const response = await fetch(url, {
    headers: buildAzureHeaders(input.apiKey),
    signal: AbortSignal.timeout(MODELS_DISCOVERY_TIMEOUT_MS),
  });

  if (response.status === 404) {
    // Some newer Azure OpenAI resources don't expose the data-plane deployments
    // listing endpoint — deployments are managed via ARM / AI Foundry instead.
    // Treat as "unsupported" so callers can fall back to manual deployment entry.
    return { kind: "unsupported", status: 404 };
  }

  if (!response.ok) {
    const bodyText = await response.text();
    let detail = "";
    try {
      const parsed = JSON.parse(bodyText) as { error?: { message?: unknown; code?: unknown } };
      const message = readNonEmptyString(parsed.error?.message);
      const code = readNonEmptyString(parsed.error?.code);
      detail = message ?? code ?? "";
    } catch {
      detail = readNonEmptyString(bodyText) ?? "";
    }
    throw new Error(
      detail
        ? `Azure OpenAI deployment discovery failed with HTTP ${response.status}: ${detail}`
        : `Azure OpenAI deployment discovery failed with HTTP ${response.status}.`,
    );
  }

  const payload = await response.json();
  return { kind: "models", models: sortAzureDeployments(parseAzureDeploymentsResponse(payload)) };
}

async function fetchAzureDeployments(input: {
  endpoint: string;
  apiKey: string;
}): Promise<AdapterModel[]> {
  const result = await fetchAzureDeploymentsRaw(input);
  if (result.kind === "unsupported") return [];
  return result.models;
}

function cacheModels(cacheKey: string, models: AdapterModel[]) {
  discoveryCache.set(cacheKey, {
    expiresAt: Date.now() + MODELS_CACHE_TTL_MS,
    models,
  });
}

export async function discoverAzureOpenaiModels(input: {
  endpoint?: unknown;
  apiKey?: unknown;
} = {}): Promise<AdapterModel[]> {
  const apiKey = readApiKeyFromConfigOrEnv(input.apiKey);
  if (!apiKey) {
    throw new Error("Azure OpenAI API key is missing. Set AZURE_OPENAI_API_KEY.");
  }
  const endpoint = readEndpointFromConfigOrEnv(input.endpoint);
  if (!endpoint) {
    throw new Error("Azure OpenAI endpoint is missing. Set AZURE_OPENAI_ENDPOINT.");
  }
  return fetchAzureDeployments({ endpoint, apiKey });
}

export async function discoverAzureOpenaiModelsCached(input: {
  endpoint?: unknown;
  apiKey?: unknown;
} = {}): Promise<AdapterModel[]> {
  const apiKey = readApiKeyFromConfigOrEnv(input.apiKey);
  if (!apiKey) {
    throw new Error("Azure OpenAI API key is missing. Set AZURE_OPENAI_API_KEY.");
  }
  const endpoint = readEndpointFromConfigOrEnv(input.endpoint);
  if (!endpoint) {
    throw new Error("Azure OpenAI endpoint is missing. Set AZURE_OPENAI_ENDPOINT.");
  }
  const key = discoveryCacheKey(endpoint, apiKey);
  const now = Date.now();
  pruneExpiredDiscoveryCache(now);
  const cached = discoveryCache.get(key);
  if (cached && cached.expiresAt > now) return cached.models;

  const models = await fetchAzureDeployments({ endpoint, apiKey });
  cacheModels(key, models);
  return models;
}

export async function listAzureOpenaiModels(): Promise<AdapterModel[]> {
  return discoverAzureOpenaiModelsCached();
}

export async function refreshAzureOpenaiModels(): Promise<AdapterModel[]> {
  discoveryCache.clear();
  return discoverAzureOpenaiModelsCached();
}

export function requireAzureDeploymentId(input: unknown): string {
  const deployment = readNonEmptyString(input);
  if (!deployment) {
    throw new Error("Azure OpenAI adapter requires `deployment` on adapterConfig");
  }
  return deployment;
}

export function requireAzureEndpoint(rawConfig: unknown): string {
  const endpoint = readEndpointFromConfigOrEnv(rawConfig);
  if (!endpoint) {
    throw new Error("Azure OpenAI endpoint is missing. Set AZURE_OPENAI_ENDPOINT or `endpoint` on adapterConfig.");
  }
  return endpoint;
}

export function requireAzureApiKey(rawConfig: unknown): string {
  const apiKey = readApiKeyFromConfigOrEnv(rawConfig);
  if (!apiKey) {
    throw new Error("Azure OpenAI API key is missing. Set AZURE_OPENAI_API_KEY.");
  }
  return apiKey;
}

/**
 * Heuristic: does this deployment look like an o-series reasoning model?
 *
 * o-series models (o1, o3, o4, ...) reject the `temperature` parameter and
 * require `max_completion_tokens` instead of `max_tokens`. We detect by
 * deployment name prefix because Azure deployment names are operator-chosen
 * and the underlying base model isn't visible at execute time.
 */
export function isReasoningDeployment(deployment: string): boolean {
  return /^o\d+(?:-|$)/i.test(deployment.trim());
}

export function buildAzureChatCompletionsUrl(input: {
  endpoint: string;
  deployment: string;
  apiVersion: string;
}): string {
  return `${input.endpoint}/openai/deployments/${encodeURIComponent(input.deployment)}/chat/completions?api-version=${encodeURIComponent(input.apiVersion)}`;
}

export function buildAzureChatHeaders(apiKey: string): Record<string, string> {
  return {
    "api-key": apiKey,
    "Content-Type": "application/json",
  };
}

function failResult(code: string, message: string): AdapterEnvironmentTestResult {
  return {
    adapterType: "azure_openai",
    status: "fail",
    checks: [{ code, level: "error", message }],
    testedAt: new Date().toISOString(),
  };
}

export async function testAzureOpenaiEnvironment(
  ctx: AdapterEnvironmentTestContext & { config: Record<string, unknown> },
): Promise<AdapterEnvironmentTestResult> {
  const apiKey = readApiKeyFromConfigOrEnv(ctx.config);
  if (!apiKey) {
    return failResult("azure_openai_api_key_missing", "Azure OpenAI API key is missing. Set AZURE_OPENAI_API_KEY.");
  }
  const endpoint = readEndpointFromConfigOrEnv(ctx.config);
  if (!endpoint) {
    return failResult("azure_openai_endpoint_missing", "Azure OpenAI endpoint is missing. Set AZURE_OPENAI_ENDPOINT.");
  }
  try {
    const result = await fetchAzureDeploymentsRaw({ endpoint, apiKey });
    if (result.kind === "unsupported") {
      return {
        adapterType: "azure_openai",
        status: "warn",
        checks: [
          {
            code: "azure_openai_listing_unsupported",
            level: "warn",
            message: `Azure OpenAI reachable at ${endpoint}, but the deployments listing endpoint is not available on this resource. Enter the deployment name manually in the agent config.`,
          },
        ],
        testedAt: new Date().toISOString(),
      };
    }
    if (result.models.length === 0) {
      return {
        adapterType: "azure_openai",
        status: "warn",
        checks: [
          {
            code: "azure_openai_no_deployments",
            level: "warn",
            message: `Azure OpenAI reachable at ${endpoint}, but no deployments were returned. Deploy a model in Azure AI Foundry.`,
          },
        ],
        testedAt: new Date().toISOString(),
      };
    }

    return {
      adapterType: "azure_openai",
      status: "pass",
      checks: [
        {
          code: "azure_openai_deployments_reachable",
          level: "info",
          message: `Azure OpenAI deployments reachable at ${endpoint} (${result.models.length} deployment${result.models.length === 1 ? "" : "s"} discovered).`,
        },
      ],
      testedAt: new Date().toISOString(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failResult("azure_openai_deployment_discovery_failed", message);
  }
}

export function resetAzureOpenaiModelsCacheForTests() {
  discoveryCache.clear();
}
