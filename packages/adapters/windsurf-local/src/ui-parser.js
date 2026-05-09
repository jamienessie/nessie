function parseJson(line) {
  try {
    const parsed = JSON.parse(line);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function asString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringify(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function pickToolUseId(parsed) {
  return asString(parsed.toolCallId) || asString(parsed.toolUseId) || asString(parsed.id);
}

function statusText(parsed) {
  const text = asString(parsed.text).trim();
  const tag = asString(parsed.tag).trim();
  const used = asNumber(parsed.used, -1);
  const size = asNumber(parsed.size, -1);
  const parts = [];
  if (text) parts.push(text);
  if (tag && !text) parts.push(tag);
  if (used >= 0 && size > 0) parts.push(`(${used}/${size} ctx)`);
  return parts.join(" ") || tag || "status";
}

function parseStdoutLine(line, ts) {
  const parsed = parseJson(line);
  if (!parsed) return [{ kind: "stdout", ts, text: line }];

  const type = asString(parsed.type);
  if (type === "acpx.session") {
    const mode = asString(parsed.mode);
    const permissionMode = asString(parsed.permissionMode);
    const model = asString(parsed.model, "swe-1-6-fast");
    const tail = [model, mode, permissionMode].filter(Boolean).join(" / ");
    return [{
      kind: "init",
      ts,
      model: tail ? `windsurf (${tail})` : "windsurf",
      sessionId: asString(parsed.acpSessionId) || asString(parsed.sessionId) || asString(parsed.runtimeSessionName),
    }];
  }

  if (type === "acpx.text_delta") {
    const text = asString(parsed.text);
    if (!text) return [];
    const channel = asString(parsed.channel) || asString(parsed.stream);
    return [{
      kind: channel === "thought" || channel === "thinking" ? "thinking" : "assistant",
      ts,
      text,
      delta: true,
    }];
  }

  if (type === "acpx.tool_call") {
    const status = asString(parsed.status);
    const text = asString(parsed.text);
    const name = asString(parsed.name, "acp_tool");
    const toolUseId = pickToolUseId(parsed);
    const input = parsed.input !== undefined
      ? parsed.input
      : text || status
        ? { ...(text ? { text } : {}), ...(status ? { status } : {}) }
        : {};
    const entries = [{
      kind: "tool_call",
      ts,
      name,
      toolUseId: toolUseId || undefined,
      input,
    }];
    if (status === "completed" || status === "failed" || status === "cancelled") {
      entries.push({
        kind: "tool_result",
        ts,
        toolUseId: toolUseId || name,
        toolName: name,
        content: text || status,
        isError: status !== "completed",
      });
    }
    return entries;
  }

  if (type === "acpx.tool_result") {
    return [{
      kind: "tool_result",
      ts,
      toolUseId: pickToolUseId(parsed) || asString(parsed.name, "acp_tool"),
      toolName: asString(parsed.name) || undefined,
      content: stringify(parsed.content ?? parsed.output ?? parsed.error),
      isError: parsed.isError === true || parsed.error !== undefined,
    }];
  }

  if (type === "acpx.status") {
    return [{ kind: "system", ts, text: statusText(parsed) }];
  }

  if (type === "acpx.result") {
    return [{
      kind: "result",
      ts,
      text: asString(parsed.summary, asString(parsed.stopReason, asString(parsed.text))),
      inputTokens: asNumber(parsed.inputTokens),
      outputTokens: asNumber(parsed.outputTokens),
      cachedTokens: asNumber(parsed.cachedTokens),
      costUsd: asNumber(parsed.costUsd),
      subtype: asString(parsed.subtype, asString(parsed.stopReason, "windsurf.result")),
      isError: parsed.isError === true,
      errors: Array.isArray(parsed.errors) ? parsed.errors.map((error) => stringify(error)).filter(Boolean) : [],
    }];
  }

  if (type === "acpx.error") {
    return [{ kind: "stderr", ts, text: asString(parsed.message, line) }];
  }

  if (type.startsWith("acpx.")) {
    return [{ kind: "system", ts, text: asString(parsed.message, type) }];
  }

  return [{ kind: "stdout", ts, text: line }];
}

exports.parseStdoutLine = parseStdoutLine;
