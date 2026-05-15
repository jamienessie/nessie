import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { agents } from "@nessie/db";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/activity-log.js";
import { publishLiveEvent } from "../services/live-events.js";

// Per-agent "Behaviors" surface. A dedicated endpoint that flips the
// next-up runtimeConfig flags introduced by Coaching Notes, Auto-Router,
// Output Self-Critic, Pre-Flight Check, and Consensus Mode. Scoped so
// the operator never has to hand-edit JSON for these features.
//
// Returns the canonical resolved Behaviors object so the UI can avoid
// re-deriving it.

function pickCompanyId(req: Request): string | null {
  const fromHeader = req.header("x-nessie-company-id")?.trim();
  if (fromHeader) return fromHeader;
  const fromQuery = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
  if (fromQuery) return fromQuery;
  const fromBody =
    req.body && typeof req.body === "object" && typeof (req.body as Record<string, unknown>).companyId === "string"
      ? ((req.body as Record<string, unknown>).companyId as string).trim()
      : "";
  return fromBody || null;
}

function paramId(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : (value ?? "");
}

export interface AgentBehaviors {
  autoRouter: boolean;
  preFlight: boolean;
  selfCritic: boolean;
  consensus: {
    enabled: boolean;
    models: string[];
    judgeModel: string | null;
    taskType: string | null;
  };
}

function readBehaviors(runtimeConfig: unknown, adapterConfig: unknown): AgentBehaviors {
  const rc = (runtimeConfig && typeof runtimeConfig === "object" && !Array.isArray(runtimeConfig))
    ? (runtimeConfig as Record<string, unknown>)
    : {};
  const ac = (adapterConfig && typeof adapterConfig === "object" && !Array.isArray(adapterConfig))
    ? (adapterConfig as Record<string, unknown>)
    : {};
  const cc = (rc.consensus && typeof rc.consensus === "object" && !Array.isArray(rc.consensus))
    ? (rc.consensus as Record<string, unknown>)
    : {};
  return {
    autoRouter: rc.autoRouter === true,
    preFlight: rc.preFlight === true,
    selfCritic: ac.selfCritic === true,
    consensus: {
      enabled: cc.enabled === true,
      models: Array.isArray(cc.models)
        ? (cc.models as unknown[]).filter((m): m is string => typeof m === "string")
        : [],
      judgeModel: typeof cc.judgeModel === "string" ? cc.judgeModel : null,
      taskType: typeof cc.taskType === "string" ? cc.taskType : null,
    },
  };
}

function asBool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function agentBehaviorsRoutes(db: Db): Router {
  const router = Router();

  router.get("/agents/:id/behaviors", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const rows = await db
      .select({
        id: agents.id,
        companyId: agents.companyId,
        runtimeConfig: agents.runtimeConfig,
        adapterConfig: agents.adapterConfig,
      })
      .from(agents)
      .where(eq(agents.id, paramId(req, "id")))
      .limit(1);
    const row = rows[0];
    if (!row || row.companyId !== companyId) {
      res.status(404).json({ error: "agent not found" });
      return;
    }
    res.json({ behaviors: readBehaviors(row.runtimeConfig, row.adapterConfig) });
  });

  router.put("/agents/:id/behaviors", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const consensusBody = (body.consensus && typeof body.consensus === "object" && !Array.isArray(body.consensus))
      ? (body.consensus as Record<string, unknown>)
      : null;

    const rows = await db
      .select({
        id: agents.id,
        companyId: agents.companyId,
        runtimeConfig: agents.runtimeConfig,
        adapterConfig: agents.adapterConfig,
      })
      .from(agents)
      .where(eq(agents.id, paramId(req, "id")))
      .limit(1);
    const row = rows[0];
    if (!row || row.companyId !== companyId) {
      res.status(404).json({ error: "agent not found" });
      return;
    }

    const rc = (row.runtimeConfig as Record<string, unknown> | null) ?? {};
    const ac = (row.adapterConfig as Record<string, unknown> | null) ?? {};
    const nextRc: Record<string, unknown> = { ...rc };
    const nextAc: Record<string, unknown> = { ...ac };
    const autoRouter = asBool(body.autoRouter);
    if (autoRouter !== undefined) nextRc.autoRouter = autoRouter;
    const preFlight = asBool(body.preFlight);
    if (preFlight !== undefined) nextRc.preFlight = preFlight;
    const selfCritic = asBool(body.selfCritic);
    if (selfCritic !== undefined) nextAc.selfCritic = selfCritic;
    if (consensusBody) {
      const prevConsensus = (rc.consensus && typeof rc.consensus === "object" && !Array.isArray(rc.consensus))
        ? (rc.consensus as Record<string, unknown>)
        : {};
      const nextConsensus: Record<string, unknown> = { ...prevConsensus };
      const enabled = asBool(consensusBody.enabled);
      if (enabled !== undefined) nextConsensus.enabled = enabled;
      if (Array.isArray(consensusBody.models)) {
        nextConsensus.models = (consensusBody.models as unknown[]).filter(
          (m): m is string => typeof m === "string",
        );
      }
      if (typeof consensusBody.judgeModel === "string") {
        nextConsensus.judgeModel = consensusBody.judgeModel;
      } else if (consensusBody.judgeModel === null) {
        delete nextConsensus.judgeModel;
      }
      if (typeof consensusBody.taskType === "string") {
        nextConsensus.taskType = consensusBody.taskType;
      } else if (consensusBody.taskType === null) {
        delete nextConsensus.taskType;
      }
      nextRc.consensus = nextConsensus;
    }

    await db
      .update(agents)
      .set({ runtimeConfig: nextRc, adapterConfig: nextAc, updatedAt: new Date() })
      .where(eq(agents.id, row.id));
    const behaviors = readBehaviors(nextRc, nextAc);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: "agent.behaviors_updated",
      entityType: "agent",
      entityId: row.id,
      details: behaviors as unknown as Record<string, unknown>,
    });
    publishLiveEvent({
      companyId,
      type: "agent.behaviors_updated",
      payload: { agentId: row.id, behaviors: behaviors as unknown as Record<string, unknown> },
    });
    res.json({ behaviors });
  });

  return router;
}
