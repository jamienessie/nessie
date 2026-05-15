import type { Db } from "@nessie/db";
import { agentService } from "./agents.js";
import { heartbeatService } from "./heartbeat.js";
import { logActivity } from "./activity-log.js";
import type { PluginWorkerManager } from "./plugin-worker-manager.js";

export interface PanicStopInput {
  companyId: string;
  actorType: "user" | "agent" | "system";
  actorId: string;
}

export interface PanicStopResult {
  pausedCount: number;
  runsCancelled: number;
  skippedCount: number;
}

export interface PanicStopServiceOptions {
  pluginWorkerManager?: PluginWorkerManager;
}

export function panicStopService(db: Db, options: PanicStopServiceOptions = {}) {
  const agents = agentService(db);
  const heartbeat = heartbeatService(db, { pluginWorkerManager: options.pluginWorkerManager });

  return {
    async execute(input: PanicStopInput): Promise<PanicStopResult> {
      const roster = await agents.list(input.companyId);

      let pausedCount = 0;
      let runsCancelled = 0;
      let skippedCount = 0;

      for (const agent of roster) {
        if (agent.status === "terminated" || agent.status === "pending_approval") {
          skippedCount += 1;
          continue;
        }

        if (agent.status !== "paused") {
          try {
            const paused = await agents.pause(agent.id, "panic_stop");
            if (paused) pausedCount += 1;
          } catch {
            skippedCount += 1;
            continue;
          }
        }

        const cancelled = await heartbeat.cancelActiveForAgent(agent.id);
        runsCancelled += cancelled;
      }

      await logActivity(db, {
        companyId: input.companyId,
        actorType: input.actorType,
        actorId: input.actorId,
        action: "company.panic_stopped",
        entityType: "company",
        entityId: input.companyId,
        details: {
          pausedCount,
          runsCancelled,
          skippedCount,
          totalAgents: roster.length,
        },
      });

      return { pausedCount, runsCancelled, skippedCount };
    },
  };
}
