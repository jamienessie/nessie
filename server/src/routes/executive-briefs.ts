import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { executiveBriefsService, type BriefPeriod } from "../services/executive-briefs.js";

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function pickCompanyId(req: Request): string | null {
  const fromHeader = req.header("x-nessie-company-id")?.trim();
  if (fromHeader) return fromHeader;
  const fromQuery = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
  return fromQuery || null;
}

export function executiveBriefRoutes(db: Db): Router {
  const router = Router();
  const svc = executiveBriefsService(db);

  router.post("/briefs/compose", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const period = pickString((req.body ?? {}).period) as BriefPeriod | null;
    if (!period || !["daily", "weekly", "monthly"].includes(period)) {
      res.status(400).json({ error: "period must be daily | weekly | monthly" });
      return;
    }
    const brief = await svc.compose(period, companyId);
    res.status(201).json({ brief });
  });

  return router;
}
