import type { AdapterModel, AdapterModelProfileDefinition } from "@nessie/adapter-utils";

export const type = "gemini_compatible";
export const label = "Google Gemini";

// Model catalog is populated at runtime via live discovery against
// Google's /v1beta/models endpoint, then filtered to known-free-tier
// model names. Static `models` is kept empty so the model picker waits
// for the live list (mirrors openrouter_compatible).
export const models: AdapterModel[] = [];
export const modelProfiles: AdapterModelProfileDefinition[] = [];

export const agentConfigurationDoc = `# gemini_compatible agent configuration

Adapter: gemini_compatible

Use when:
- You want Paperclip to run against Google's Gemini API directly with an API key
- You want the model picker to be filtered to free-tier Gemini models only
- You don't want to install the Google Gemini CLI locally

Core fields:
- model (string, required): Gemini model id, e.g. "gemini-2.0-flash"
- baseUrl (string, optional): Gemini API base URL; defaults to https://generativelanguage.googleapis.com/v1beta
- apiKey (string, required if not in env): Google AI API key
- systemPrompt (string, optional): system message prepended to each request
- temperature (number, optional): 0..2
- maxTokens (number, optional): output token cap

Authentication:
- GEMINI_API_KEY (or GOOGLE_API_KEY) must be set in the agent Environment or the host environment
- The adapter uses Gemini's OpenAI-compatible endpoint at /v1beta/openai/chat/completions

Free-tier filter:
- Model discovery returns the full Gemini catalog, then filters to names
  containing "flash" / "flash-lite" / "flash-8b" and excludes "pro" / "ultra".
- These are the models with a generous free tier on Google AI Studio.
- The pro/ultra families are excluded because they only have a tiny free
  quota (or none), and exposing them would hide hard cost spikes.
`;
