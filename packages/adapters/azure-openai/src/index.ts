import type { AdapterModel, AdapterModelProfileDefinition } from "@nessie/adapter-utils";

export const type = "azure_openai";
export const label = "Azure OpenAI";

export const models: AdapterModel[] = [];
export const modelProfiles: AdapterModelProfileDefinition[] = [];

export const agentConfigurationDoc = `# azure_openai agent configuration

Adapter: azure_openai

Use when:
- You want Nessie to run against an Azure OpenAI Service resource you control
- You want the model picker to reflect the deployments you've created in Azure
- You want spend to land on your Azure subscription (e.g. free trial credit)

Core fields:
- deployment (string, required): Azure deployment name (e.g. "gpt-4o", "gpt-4o-mini").
  This is NOT the OpenAI model id — it is the deployment name you chose in
  Azure AI Foundry when deploying the base model.
- endpoint (string, optional): Azure OpenAI resource endpoint, e.g.
  "https://nessie-openai-jamie.openai.azure.com". Falls back to AZURE_OPENAI_ENDPOINT.
- apiVersion (string, optional): Azure REST API version. Defaults to "2024-10-21".
- systemPrompt (string, optional): system message prepended to each request
- temperature (number, optional): 0..2
- maxTokens (number, optional): output token cap

Authentication:
- AZURE_OPENAI_API_KEY must be set in the Nessie host environment for deployment
  discovery and execution.
- AZURE_OPENAI_ENDPOINT must be set in the host environment unless overridden in
  the per-agent adapterConfig.
- AZURE_OPENAI_API_VERSION optionally overrides the default REST API version.

Notes:
- Deployment discovery is live (with a short server-side cache) and lists every
  deployment configured on your Azure resource.
- Azure derives the model from the deployment name in the URL, so the request body
  does NOT include a "model" field.
- This adapter calls Azure's chat completions endpoint directly; it does not spawn
  a local CLI.
`;
