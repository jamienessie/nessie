import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { timeTravelService } from "../services/time-travel.js";
import { assertCompanyAccess } from "./authz.js";

function pickCompanyId(req: Request): string | null {
  const fromHeader = req.header("x-nessie-company-id")?.trim();
  if (fromHeader) return fromHeader;
  const fromQuery = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
  return fromQuery || null;
}

export function timeTravelRoutes(db: Db): Router {
  const router = Router();
  const svc = timeTravelService(db);

  router.get("/time-travel/snapshot", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const atRaw = typeof req.query.at === "string" ? req.query.at.trim() : "";
    const at = atRaw ? new Date(atRaw) : new Date();
    if (Number.isNaN(at.getTime())) {
      res.status(400).json({ error: "at must be an ISO 8601 timestamp" });
      return;
    }
    const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
    const view = await svc.snapshotAt(companyId, at, {
      activityLimit: Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 500) : undefined,
    });
    res.json(view);
  });

  return router;
}
