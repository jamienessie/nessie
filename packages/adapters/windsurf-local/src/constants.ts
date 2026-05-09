export const type = "windsurf_local";
export const label = "Windsurf SWE (local)";

export const DEFAULT_WINDSURF_COMMAND = "devin";
export const DEFAULT_WINDSURF_MODEL = "swe-1-6-fast";

export const models = [
  { id: "swe-1-6-fast", label: "SWE 1.6 Fast" },
  { id: "swe", label: "SWE (latest)" },
  { id: "opus", label: "Opus (latest)" },
  { id: "gpt", label: "GPT (latest)" },
  { id: "sonnet", label: "Sonnet (latest)" },
];
