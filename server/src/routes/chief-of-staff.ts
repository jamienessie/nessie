import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { chiefOfStaffService } from "../services/chief-of-staff.js";

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function pickCompanyId(req: Request): string | null {
  const fromHeader = req.header("x-nessie-company-id")?.trim();
  if (fromHeader) return fromHeader;
  const fromQuery = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
  return fromQuery || null;
}

export function chiefOfStaffRoutes(db: Db): Router {
  const router = Router();
  const svc = chiefOfStaffService(db);

  router.post("/chief/ask", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const command = pickString((req.body ?? {}).command);
    if (!command) { res.status(400).json({ error: "command required" }); return; }
    const response = await svc.ask(command, { companyId });
    res.json(response);
  });

  // Always-on dashboard counts powering the Chief of Staff page's left
  // pane. The client polls this every 30s + invalidates on relevant
  // live events. Recent activity and today's meetings are fetched from
  // the existing /activity and /meetings endpoints.
  router.get("/chief/dashboard", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const counts = await svc.dashboard({ companyId });
    res.json(counts);
  });

  return router;
}
