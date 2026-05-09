// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildNewAgentHirePayload } from "./new-agent-hire-payload";
import { defaultCreateValues } from "../components/agent-config-defaults";

describe("buildNewAgentHirePayload", () => {
  it("persists the selected default environment id", () => {
    expect(
      buildNewAgentHirePayload({
        name: "Linux Claude",
        effectiveRole: "general",
        configValues: {
          ...defaultCreateValues,
          adapterType: "claude_local",
          defaultEnvironmentId: "11111111-1111-4111-8111-111111111111",
        },
        adapterConfig: { foo: "bar" },
      }),
    ).toMatchObject({
      name: "Linux Claude",
      role: "general",
      adapterType: "claude_local",
      defaultEnvironmentId: "11111111-1111-4111-8111-111111111111",
      adapterConfig: { foo: "bar" },
      budgetMonthlyCents: 0,
    });
  });

  it("sends null when no default environment is selected", () => {
    expect(
      buildNewAgentHirePayload({
        name: "Local Claude",
        effectiveRole: "general",
        configValues: {
          ...defaultCreateValues,
          adapterType: "claude_local",
        },
        adapterConfig: {},
      }),
    ).toMatchObject({
      defaultEnvironmentId: null,
    });
  });

  it("persists create-time env bindings into adapterConfig.env", () => {
    const payload = buildNewAgentHirePayload({
      name: "OpenRouter Agent",
      effectiveRole: "general",
      configValues: {
        ...defaultCreateValues,
        adapterType: "openrouter_compatible",
        envBindings: {
          OPENROUTER_API_KEY: { type: "secret_ref", secretId: "secret-openrouter", version: "latest" },
          OPENROUTER_HTTP_REFERER: { type: "plain", value: "https://example.com" },
        },
        envVars: "OPENROUTER_TITLE=Paperclip",
      },
      adapterConfig: {
        model: "openai/gpt-5.2",
      },
    });

    expect(payload.adapterConfig).toMatchObject({
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
