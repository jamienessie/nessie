import { describe, expect, it } from "vitest";
import type { CreateConfigValues } from "@nessie/adapter-utils";
import { buildOpenRouterConfig } from "./build-config";

describe("buildOpenRouterConfig", () => {
  it("copies env bindings into adapterConfig.env so create-time auth survives", () => {
    const values: CreateConfigValues = {
      adapterType: "openrouter_compatible",
      cwd: "",
      instructionsFilePath: "",
      promptTemplate: "",
      model: "openai/gpt-5.2",
      thinkingEffort: "",
      chrome: false,
      dangerouslySkipPermissions: true,
      search: false,
      fastMode: false,
      dangerouslyBypassSandbox: false,
      command: "",
      args: "",
      extraArgs: "",
      envVars: "OPENROUTER_TITLE=Paperclip",
      envBindings: {
        OPENROUTER_API_KEY: { type: "secret_ref", secretId: "secret-openrouter", version: "latest" },
        OPENROUTER_HTTP_REFERER: { type: "plain", value: "https://example.com" },
      },
      url: "",
      bootstrapPrompt: "",
      payloadTemplateJson: "",
      workspaceStrategyType: "project_primary",
      worktreeParentDir: "",
      workspaceBaseRef: "",
      workspaceBranchTemplate: "",
      runtimeServicesJson: "",
      maxTurnsPerRun: 1000,
      heartbeatEnabled: false,
      intervalSec: 300,
    };

    expect(buildOpenRouterConfig(values)).toMatchObject({
      model: "openai/gpt-5.2",
      env: {
        OPENROUTER_API_KEY: {
          type: "secret_ref",
          secretId: "secret-openrouter",
          version: "latest",
        },
        OPENROUTER_HTTP_REFERER: {
          type: "plain",
          value: "https://example.com",
        },
        OPENROUTER_TITLE: {
          type: "plain",
          value: "Paperclip",
        },
      },
    });
  });
});
