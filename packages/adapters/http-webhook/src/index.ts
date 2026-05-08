// Top-level metadata for the http-webhook adapter.
//
// Useful when an agent is an external HTTP service (Zapier, n8n, a custom
// FastAPI worker, a human-in-the-loop bot). On every heartbeat Nessie
// POSTs the run payload to the configured URL and treats the JSON
// response as the agent's output.

export const type = "http_webhook";
export const label = "HTTP webhook";

export const models = [
  { id: "webhook", label: "External webhook" },
];

export const agentConfigurationDoc = `# http_webhook agent configuration

Adapter: http_webhook

Sends one POST per heartbeat to the configured URL with a JSON body
containing the run context (heartbeatRunId, agentId, prompt, prior
messages, skills, worktree path, evidence). Awaits a JSON response
shaped like:

  {
    "summary": "what the agent did",
    "outputText": "free-form text shown in the run feed",
    "sessionId": "optional, returned on subsequent calls for resume",
    "usage": { "inputTokens": 0, "outputTokens": 0 },
    "costUsd": 0,
    "metadata": { ... }
  }

Core fields:
- url (string, required): the webhook URL Nessie POSTs to.
- bearerToken (string, optional): if set, sent as 'Authorization: Bearer ...'.
- bearerTokenEnv (string, optional): if set, the bearer token is read from
  process.env[bearerTokenEnv] at execute time. Preferred over inline tokens.
- headers (object, optional): extra headers to include on the POST.
- timeoutMs (number, optional, default 60000): request timeout.
- healthUrl (string, optional): GET probe URL for testEnvironment(). When
  unset the same 'url' is used with method=OPTIONS.

Notes:
- This adapter does not spawn subprocesses, manage worktrees, or sync
  skills. The receiver is responsible for whatever local work the
  agent performs.
- Cost reporting honoured if the webhook returns 'costUsd' or 'usage'.
`;
