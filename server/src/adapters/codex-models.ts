import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import type { AdapterModel } from "./types.js";
import { asString } from "@nessie/adapter-utils/server-utils";

const CODEX_MODELS_CACHE_TTL_MS = 60_000;
const CODEX_MODELS_DISCOVERY_TIMEOUT_MS = 20_000;

let cached: { expiresAt: number; models: AdapterModel[] } | null = null;

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

async function resolveCodexCommand(): Promise<string> {
  const explicit = asString(process.env.PAPERCLIP_CODEX_COMMAND, "").trim();
  if (explicit) return explicit;

  if (process.platform === "win32") {
    const candidate = path.join(process.env.LOCALAPPDATA ?? "", "OpenAI", "Codex", "bin", "codex.exe");
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Fall back to PATH.
    }
  }

  return "codex";
}

type RpcResponse = {
  id?: unknown;
  result?: { data?: unknown };
  error?: { message?: string };
};

function createRpcClient(command: string) {
  const proc = spawn(command, ["-s", "read-only", "-a", "untrusted", "app-server"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  proc.stdout.setEncoding("utf8");
  proc.stderr.setEncoding("utf8");

  let nextId = 1;
  let buffer = "";
  let stderr = "";
  const pending = new Map<number, { resolve: (response: RpcResponse) => void; reject: (error: Error) => void }>();

  const send = (method: string, params: Record<string, unknown> = {}) => {
    const id = nextId++;
    return new Promise<RpcResponse>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      proc.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  };

  proc.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    while (true) {
      const newlineIndex = buffer.indexOf("\n");
      if (newlineIndex < 0) break;
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      let message: RpcResponse;
      try {
        message = JSON.parse(line) as RpcResponse;
      } catch {
        continue;
      }
      if (typeof message.id !== "number") continue;
      const request = pending.get(message.id);
      if (!request) continue;
      pending.delete(message.id);
      request.resolve(message);
    }
  });

  proc.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const shutdown = () => {
    try {
      proc.kill("SIGTERM");
    } catch {
      // ignore
    }
    try {
      proc.kill("SIGKILL");
    } catch {
      // ignore
    }
  };

  const rejectPending = (error: Error) => {
    shutdown();
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  proc.on("error", (error) => {
    rejectPending(error instanceof Error ? error : new Error(String(error)));
  });

  proc.on("exit", (code) => {
    if (pending.size === 0) return;
    rejectPending(
      new Error(stderr.trim() || `Codex app-server exited unexpectedly${typeof code === "number" ? ` (exit code ${code})` : ""}.`),
    );
  });

  return { proc, send, shutdown, rejectPending };
}

async function discoverCodexModels(): Promise<AdapterModel[]> {
  const command = await resolveCodexCommand();
  const client = createRpcClient(command);
  const timeout = setTimeout(() => {
    client.rejectPending(new Error(`Codex model discovery timed out after ${CODEX_MODELS_DISCOVERY_TIMEOUT_MS / 1000}s.`));
  }, CODEX_MODELS_DISCOVERY_TIMEOUT_MS);

  try {
    const initializeResponse = await client.send("initialize", {
      clientInfo: {
        name: "paperclip",
        version: "0.0.0",
      },
    });
    if (initializeResponse.error) {
      throw new Error(initializeResponse.error.message || "Codex app-server initialization failed.");
    }

    client.proc.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);

    const response = await client.send("model/list", {});
    if (response.error) {
      throw new Error(response.error.message || "Codex app-server model discovery failed.");
    }

    const data = response.result?.data;
    if (!Array.isArray(data)) {
      throw new Error("Codex app-server returned an unexpected model payload.");
    }

    const models: AdapterModel[] = [];
    for (const item of data) {
      if (typeof item !== "object" || item === null) continue;
      if ((item as { hidden?: unknown }).hidden === true) continue;
      const id = typeof (item as { id?: unknown }).id === "string" ? ((item as { id: string }).id.trim()) : "";
      if (!id) continue;
      const displayName = typeof (item as { displayName?: unknown }).displayName === "string"
        ? ((item as { displayName: string }).displayName.trim())
        : "";
      models.push({ id, label: displayName || id });
    }

    const deduped = dedupeModels(models);
    if (deduped.length === 0) {
      throw new Error("Codex app-server returned no visible models.");
    }
    return deduped;
  } finally {
    clearTimeout(timeout);
    client.shutdown();
  }
}

async function loadCodexModels(options?: { forceRefresh?: boolean }): Promise<AdapterModel[]> {
  const forceRefresh = options?.forceRefresh === true;
  const now = Date.now();
  if (!forceRefresh && cached && cached.expiresAt > now) {
    return cached.models;
  }

  const models = await discoverCodexModels();
  cached = {
    expiresAt: now + CODEX_MODELS_CACHE_TTL_MS,
    models,
  };
  return models;
}

export async function listCodexModels(): Promise<AdapterModel[]> {
  return loadCodexModels();
}

export async function refreshCodexModels(): Promise<AdapterModel[]> {
  return loadCodexModels({ forceRefresh: true });
}

export function resetCodexModelsCacheForTests() {
  cached = null;
}
