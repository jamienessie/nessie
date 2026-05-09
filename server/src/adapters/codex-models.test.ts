import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { listCodexModels, refreshCodexModels, resetCodexModelsCacheForTests } from "./codex-models.js";

type FakeCodexProcess = EventEmitter & {
  stdin: { write: (chunk: string) => boolean };
  stdout: EventEmitter & { setEncoding: (encoding: string) => void };
  stderr: EventEmitter & { setEncoding: (encoding: string) => void };
  kill: (signal?: NodeJS.Signals | number) => boolean;
};

const codexDiscoveryState = vi.hoisted(() => {
  const state = {
    models: [
      { id: "gpt-5.5", displayName: "GPT-5.5" },
      { id: "gpt-5.4", displayName: "GPT-5.4" },
      { id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" },
      { id: "gpt-5.4-mini", displayName: "Duplicate entry" },
      { id: "hidden-model", displayName: "Hidden Model", hidden: true },
      { id: "", displayName: "Missing Id" },
    ],
    spawnCount: 0,
    createProcess(): FakeCodexProcess {
      const proc = new EventEmitter() as FakeCodexProcess;
      const stdout = new EventEmitter() as FakeCodexProcess["stdout"];
      const stderr = new EventEmitter() as FakeCodexProcess["stderr"];

      stdout.setEncoding = vi.fn();
      stderr.setEncoding = vi.fn();

      const respond = (payload: unknown) => {
        queueMicrotask(() => {
          stdout.emit("data", `${JSON.stringify(payload)}\n`);
        });
      };

      proc.stdout = stdout;
      proc.stderr = stderr;
      proc.stdin = {
        write: (chunk: string) => {
          const message = JSON.parse(chunk.trim()) as { id?: number; method?: string };
          if (message.method === "initialize") {
            respond({ id: message.id, result: { data: { protocolVersion: "2025-05-01" } } });
          } else if (message.method === "model/list") {
            respond({ id: message.id, result: { data: state.models } });
          }
          return true;
        },
      };
      proc.kill = vi.fn(() => true);
      return proc;
    },
  };
  return state;
});

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    codexDiscoveryState.spawnCount += 1;
    return codexDiscoveryState.createProcess();
  }),
}));

describe("codex model discovery", () => {
  beforeEach(() => {
    resetCodexModelsCacheForTests();
    codexDiscoveryState.spawnCount = 0;
    codexDiscoveryState.models = [
      { id: "gpt-5.5", displayName: "GPT-5.5" },
      { id: "gpt-5.4", displayName: "GPT-5.4" },
      { id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" },
      { id: "gpt-5.4-mini", displayName: "Duplicate entry" },
      { id: "hidden-model", displayName: "Hidden Model", hidden: true },
      { id: "", displayName: "Missing Id" },
    ];
  });

  it("discovers only visible codex models and deduplicates them", async () => {
    const models = await listCodexModels();

    expect(codexDiscoveryState.spawnCount).toBe(1);
    expect(models).toEqual([
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4", label: "GPT-5.4" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    ]);
  });

  it("caches discovered codex models until refresh is requested", async () => {
    const first = await listCodexModels();
    codexDiscoveryState.models = [
      { id: "gpt-5.5", displayName: "GPT-5.5" },
      { id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" },
    ];
    const second = await listCodexModels();
    const refreshed = await refreshCodexModels();

    expect(first).toEqual(second);
    expect(codexDiscoveryState.spawnCount).toBe(2);
    expect(refreshed).toEqual([
      { id: "gpt-5.5", label: "GPT-5.5" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini" },
    ]);
  });

  it("surfaces an empty discovery result as an error", async () => {
    codexDiscoveryState.models = [];

    await expect(listCodexModels()).rejects.toThrow("Codex app-server returned no visible models.");
  });
});
