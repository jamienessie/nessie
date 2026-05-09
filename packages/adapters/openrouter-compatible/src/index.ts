import type { AdapterModel, AdapterModelProfileDefinition } from "@nessie/adapter-utils";

export const type = "openrouter_compatible";
export const label = "OpenRouter";

export const models: AdapterModel[] = [];
export const modelProfiles: AdapterModelProfileDefinition[] = [];

export const agentConfigurationDoc = `# openrouter_compatible agent configuration

Adapter: openrouter_compatible

Use when:
- You want Paperclip to run against OpenRouter's hosted model catalog
- You want access to the live OpenRouter model list, including free models
- You want the model picker to reflect the actual models available to your API key

Core fields:
- model (string, required): OpenRouter model id, e.g. "openai/gpt-5.2"
- baseUrl (string, optional): OpenRouter API base URL; defaults to https://openrouter.ai/api/v1
- systemPrompt (string, optional): system message prepended to each request
- temperature (number, optional): 0..2
- maxTokens (number, optional): output token cap

Authentication:
- OPENROUTER_API_KEY must be set in the Paperclip host environment for model discovery and execution
- Optional app attribution headers can be provided via OPENROUTER_HTTP_REFERER and OPENROUTER_X_TITLE

Notes:
- Model discovery is live and only shows runnable text models.
- Free models are sorted to the top of the picker.
- This adapter uses OpenRouter's chat completions endpoint directly; it does not spawn a local CLI.
`;
