import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseWindsurfStdoutLine } from "./parse-stdout.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe("parseWindsurfStdoutLine", () => {
  it("parses ACP session init", () => {
    expect(parseWindsurfStdoutLine(JSON.stringify({
      type: "acpx.session",
      acpSessionId: "s1",
      model: "swe-1-6-fast",
      mode: "persistent",
      permissionMode: "approve-all",
    }), "ts")).toEqual([
      {
        kind: "init",
        ts: "ts",
        model: "windsurf (swe-1-6-fast / persistent / approve-all)",
        sessionId: "s1",
      },
    ]);
  });

  it("parses text deltas, tools, results, and errors", () => {
    expect(parseWindsurfStdoutLine(JSON.stringify({
      type: "acpx.text_delta",
      text: "hello",
    }), "ts")).toEqual([
      { kind: "assistant", ts: "ts", text: "hello", delta: true },
    ]);

    expect(parseWindsurfStdoutLine(JSON.stringify({
      type: "acpx.tool_call",
      name: "read",
      toolCallId: "tool-1",
      status: "completed",
      text: "done",
    }), "ts")).toEqual([
      {
        kind: "tool_call",
        ts: "ts",
        name: "read",
        toolUseId: "tool-1",
        input: { text: "done", status: "completed" },
      },
      {
        kind: "tool_result",
        ts: "ts",
        toolUseId: "tool-1",
        toolName: "read",
        content: "done",
        isError: false,
      },
    ]);

    expect(parseWindsurfStdoutLine(JSON.stringify({
      type: "acpx.result",
      summary: "complete",
      inputTokens: 1,
      outputTokens: 2,
    }), "ts")).toEqual([
      {
        kind: "result",
        ts: "ts",
        text: "complete",
        inputTokens: 1,
        outputTokens: 2,
        cachedTokens: 0,
        costUsd: 0,
        subtype: "windsurf.result",
        isError: false,
        errors: [],
      },
    ]);

    expect(parseWindsurfStdoutLine(JSON.stringify({
      type: "acpx.error",
      message: "no auth",
    }), "ts")).toEqual([
      { kind: "stderr", ts: "ts", text: "no auth" },
    ]);
  });

  it("falls back for plain stdout", () => {
    expect(parseWindsurfStdoutLine("plain", "ts")).toEqual([
      { kind: "stdout", ts: "ts", text: "plain" },
    ]);
  });

  it("ships a standalone sandbox parser export", () => {
    const source = fs.readFileSync(path.resolve(__dirname, "../ui-parser.js"), "utf8");
    const exports: { parseStdoutLine?: typeof parseWindsurfStdoutLine } = {};
    const module = { exports };
    const factory = new Function("exports", "module", source);
    factory(exports, module);

    expect(module.exports.parseStdoutLine?.(JSON.stringify({
      type: "acpx.text_delta",
      text: "hello",
    }), "ts")).toEqual([
      { kind: "assistant", ts: "ts", text: "hello", delta: true },
    ]);
  });
});
