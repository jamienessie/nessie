import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { operatorConstitutionService } from "../services/operator-constitution.js";
import { logActivity } from "../services/activity-log.js";
import { getActorInfo } from "./authz.js";

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function pickRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function pickCompanyId(req: Request): string | null {
  const fromHeader = req.header("x-nessie-company-id")?.trim();
  if (fromHeader) return fromHeader;
  const fromQuery = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
  return fromQuery || null;
}

export function operatorConstitutionRoutes(db: Db): Router {
  const router = Router();
  const svc = operatorConstitutionService(db);

  router.get("/constitution", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const constitution = await svc.getCurrent(companyId);
    res.json({ constitution });
  });

  router.get("/constitution/versions", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const versions = await svc.listVersions(companyId);
    res.json({ versions });
  });

  router.put("/constitution", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = await svc.upsert(companyId, {
      sections: pickRecord(body.sections),
      note: pickString(body.note),
      updatedByUserId: pickString(body.updatedByUserId),
    });
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "constitution.updated",
      entityType: "operator_constitution",
      entityId: result.row.id,
      details: { version: result.row.version, created: result.created },
    });
    res.status(result.created ? 201 : 200).json({ constitution: result.row });
  });

  return router;
}
