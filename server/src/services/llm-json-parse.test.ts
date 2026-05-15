import { describe, expect, it } from "vitest";
import { extractJsonObject, extractJsonArray } from "./llm-json-parse.js";

describe("extractJsonObject", () => {
  it("parses a clean JSON object", () => {
    expect(extractJsonObject('{"a": 1, "b": "x"}')).toEqual({ a: 1, b: "x" });
  });

  it("parses an object inside a fenced code block", () => {
    const text = "Here you go:\n```json\n{\"score\": 42}\n```\nThanks.";
    expect(extractJsonObject(text)).toEqual({ score: 42 });
  });

  it("falls back to the outermost braces when wrapped in prose", () => {
    const text = "Sure! { \"winner\": \"t2:gpt-4o\" } good luck.";
    expect(extractJsonObject(text)).toEqual({ winner: "t2:gpt-4o" });
  });

  it("returns null for an array (object only)", () => {
    expect(extractJsonObject("[1,2,3]")).toBeNull();
  });

  it("returns null for unparseable input", () => {
    expect(extractJsonObject("not json at all")).toBeNull();
  });
});

describe("extractJsonArray", () => {
  it("parses a clean JSON array", () => {
    expect(extractJsonArray("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  it("parses an array inside a fenced code block", () => {
    const text = "```json\n[\"a\", \"b\"]\n```";
    expect(extractJsonArray(text)).toEqual(["a", "b"]);
  });

  it("returns null for object input", () => {
    expect(extractJsonArray("{\"a\":1}")).toBeNull();
  });
});
