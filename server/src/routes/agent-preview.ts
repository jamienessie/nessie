import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { agents } from "@nessie/db";
import { assertCompanyAccess } from "./authz.js";
import { coachingNotesService } from "../services/coaching-notes.js";
import { resolveAutoRoutedModel } from "../services/auto-router.js";

// "Next-run preview" — given an agent, compute what its NEXT
// heartbeat dispatch would actually use: the assembled system prompt
// (with coaching prefix), the picked model (after Auto-Router), and
// which behaviors are armed. Pure read; no run is started.
//
// Surfaced on the AgentBehaviors page so operators can sanity-check
// the layered behavior stack without firing a real run.

function pickCompanyId(req: Request): string | null {
  const fromHeader = req.header("x-nessie-company-id")?.trim();
  if (fromHeader) return fromHeader;
  const fromQuery = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
  return fromQuery || null;
}

function paramId(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : (value ?? "");
}

export function agentPreviewRoutes(db: Db): Router {
  const router = Router();

  router.get("/agents/:id/preview", async (req: Request, res: Response) => {
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
        role: agents.role,
        runtimeConfig: agents.runtimeConfig,
        adapterConfig: agents.adapterConfig,
        tier: agents.tier,
      })
      .from(agents)
      .where(eq(agents.id, paramId(req, "id")))
      .limit(1);
    const row = rows[0];
    if (!row || row.companyId !== companyId) {
      res.status(404).json({ error: "agent not found" });
      return;
    }

    const coachingPrefix = await coachingNotesService(db).assemblePrefix(companyId, row.id);
    const routed = await resolveAutoRoutedModel(db, {
      id: row.id,
      companyId,
      role: row.role,
      runtimeConfig: row.runtimeConfig as Record<string, unknown> | null,
      adapterConfig: row.adapterConfig as Record<string, unknown> | null,
      tier: row.tier,
    });

    const ac = (row.adapterConfig as Record<string, unknown> | null) ?? {};
    const configuredSystemPrompt = typeof ac.systemPrompt === "string" ? ac.systemPrompt : "";
    const assembledSystemPrompt = coachingPrefix
      ? configuredSystemPrompt
        ? `${coachingPrefix}\n${configuredSystemPrompt}`
        : coachingPrefix
      : configuredSystemPrompt;
    const rc = (row.runtimeConfig as Record<string, unknown> | null) ?? {};
    const consensus = (rc.consensus && typeof rc.consensus === "object" && !Array.isArray(rc.consensus))
      ? (rc.consensus as Record<string, unknown>)
      : {};
    const overrideUntil = typeof rc.preFlightOverrideUntil === "string"
      ? rc.preFlightOverrideUntil
      : null;
    const overrideActive = overrideUntil
      ? new Date(overrideUntil).getTime() > Date.now()
      : false;

    res.json({
      preview: {
        agentId: row.id,
        configuredModel: typeof ac.model === "string" ? ac.model : null,
        resolvedModel: routed.model || (typeof ac.model === "string" ? ac.model : null),
        routerSource: routed.source,
        routerReason: routed.reason ?? null,
        coachingPrefix: coachingPrefix || null,
        configuredSystemPrompt: configuredSystemPrompt || null,
        assembledSystemPrompt: assembledSystemPrompt || null,
        behaviors: {
          autoRouter: rc.autoRouter === true,
          preFlight: rc.preFlight === true,
          preFlightOverrideUntil: overrideActive ? overrideUntil : null,
          selfCritic: ac.selfCritic === true,
          consensus: {
            enabled: consensus.enabled === true,
            models: Array.isArray(consensus.models)
              ? (consensus.models as unknown[]).filter((m): m is string => typeof m === "string")
              : [],
            judgeModel: typeof consensus.judgeModel === "string" ? consensus.judgeModel : null,
          },
        },
      },
    });
  });

  return router;
}
