// Best-effort JSON extraction from LLM responses. Models sometimes wrap
// their JSON in prose or markdown fences even when asked not to; these
// helpers try direct parse, then fenced-block extraction, then bracket
// scan, before giving up.
//
// Returns null on failure rather than throwing — callers can retry with
// a clarifying followup or surface a structured error.

export function extractJsonObject(text: string): Record<string, unknown> | null {
  const stripped = text.trim();
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch { /* keep trying */ }
  const fenceMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const inner = JSON.parse(fenceMatch[1]);
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        return inner as Record<string, unknown>;
      }
    } catch { /* keep trying */ }
  }
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(stripped.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* nothing else to try */ }
  }
  return null;
}

export function extractJsonArray(text: string): unknown[] | null {
  const stripped = text.trim();
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* keep trying */ }
  const fenceMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const inner = JSON.parse(fenceMatch[1]);
      if (Array.isArray(inner)) return inner;
    } catch { /* keep trying */ }
  }
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(stripped.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch { /* nothing else to try */ }
  }
  return null;
}
