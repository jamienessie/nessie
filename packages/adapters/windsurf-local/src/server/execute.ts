import type { AdapterExecutionContext, AdapterExecutionResult } from "@nessie/adapter-utils";
import { createAcpxLocalExecutor } from "@nessie/adapter-acpx-local/server";
import { buildWindsurfAcpxConfig, resolveWindsurfModel } from "./config.js";
import { ensureWindsurfSkillsInjected } from "./skills.js";

const executeAcpx = createAcpxLocalExecutor();

export async function execute(ctx: AdapterExecutionContext): Promise<AdapterExecutionResult> {
  const acpxConfig = buildWindsurfAcpxConfig(ctx.config);
  await ensureWindsurfSkillsInjected({
    config: acpxConfig,
    onLog: ctx.onLog,
  });

  const result = await executeAcpx({
    ...ctx,
    config: acpxConfig,
    onMeta: ctx.onMeta
      ? async (meta) => {
          await ctx.onMeta?.({
            ...meta,
            adapterType: "windsurf_local",
            command: String(acpxConfig.agentCommand ?? meta.command),
            commandNotes: [
              "Windsurf SWE adapter launching Devin for Terminal through ACP.",
              ...(meta.commandNotes ?? []),
            ],
          });
        }
      : undefined,
  });

  return {
    ...result,
    provider: "windsurf",
    biller: "windsurf",
    billingType: result.billingType ?? "credits",
    model: result.model ?? resolveWindsurfModel(acpxConfig),
    resultJson: {
      ...(result.resultJson ?? {}),
      adapterRuntime: "devin_acp",
    },
  };
}
