function parseJson(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

export function printWindsurfStreamEvent(raw: string, debug: boolean): void {
  const parsed = parseJson(raw);
  if (!parsed) {
    if (debug) console.log(raw);
    return;
  }
  const type = asString(parsed.type);
  if (type === "acpx.text_delta") {
    process.stdout.write(asString(parsed.text));
    return;
  }
  if (type === "acpx.session") {
    console.log(`[windsurf] session ${asString(parsed.acpSessionId) || asString(parsed.sessionId) || "started"}`);
    return;
  }
  if (type === "acpx.tool_call") {
    console.log(`[tool] ${asString(parsed.name, "acp_tool")} ${asString(parsed.status)}`.trim());
    return;
  }
  if (type === "acpx.error") {
    console.error(`[windsurf] ${asString(parsed.message, "error")}`);
    return;
  }
  if (type === "acpx.result") {
    console.log(`[windsurf] ${asString(parsed.summary, asString(parsed.stopReason, "done"))}`);
    return;
  }
  if (debug) console.log(raw);
}
