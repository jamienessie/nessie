import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { trustReceiptsService } from "../services/trust-receipts.js";
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

export function trustReceiptsRoutes(db: Db): Router {
  const router = Router();
  const svc = trustReceiptsService(db);

  router.get("/trust-receipts", async (req: Request, res: Response) => {
    const scopeKind = pickString(req.query.scopeKind);
    const scopeId = pickString(req.query.scopeId);
    if (!scopeKind || !scopeId) {
      res.status(400).json({ error: "scopeKind and scopeId required" });
      return;
    }
    const receipts = await svc.listForScope(scopeKind, scopeId);
    res.json({ receipts });
  });

  router.post("/trust-receipts", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scopeKind = pickString(body.scopeKind);
    const scopeId = pickString(body.scopeId);
    const summary = pickString(body.summary);
    if (!scopeKind || !scopeId || !summary) {
      res.status(400).json({ error: "scopeKind, scopeId, summary required" });
      return;
    }
    const created = await svc.issue({
      scopeKind,
      scopeId,
      summary,
      body: pickRecord(body.body),
      issuedByUserId: pickString(body.issuedByUserId),
      issuedByAgentId: pickString(body.issuedByAgentId),
    });
    const companyId = pickCompanyId(req);
    if (companyId) {
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "trust_receipt.issued",
        entityType: "trust_receipt",
        entityId: created.id,
        details: { scopeKind, scopeId, summary },
      });
    }
    res.status(201).json({ receipt: created });
  });

  return router;
}
