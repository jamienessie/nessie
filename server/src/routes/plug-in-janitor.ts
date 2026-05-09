import { Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { agents, janitorOutages, janitorReports } from "@nessie/db";
import { runJanitorSweep, listJanitorPausedAgents, type SweepScope } from "../services/plug-in-janitor.js";
import { logger } from "../middleware/logger.js";

function pickCompanyId(req: Request): string | null {
  const fromParam = typeof req.params.companyId === "string" ? req.params.companyId.trim() : "";
  if (fromParam) return fromParam;
  const fromHeader = req.header("x-nessie-company-id")?.trim();
  if (fromHeader) return fromHeader;
  const fromQuery = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
  return fromQuery || null;
}

function pickAgentId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function pickPathId(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function plugInJanitorRoutes(db: Db): Router {
  const router = Router();

  router.post("/companies/:companyId/janitor/run", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scopeAgentId = pickAgentId(body.agentId);
    const scope: SweepScope = scopeAgentId ? { kind: "agent", agentId: scopeAgentId } : { kind: "all" };
    try {
      const result = await runJanitorSweep(db, {
        companyId,
        scope,
        triggeredBy: "manual",
      });
      res.json(result);
    } catch (err) {
      logger.error({ err, companyId }, "janitor: manual sweep failed");
      res.status(500).json({ error: err instanceof Error ? err.message : "sweep failed" });
    }
  });

  router.get("/companies/:companyId/janitor/reports", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const limitRaw = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 100 ? Math.floor(limitRaw) : 20;
    const rows = await db
      .select()
      .from(janitorReports)
      .where(eq(janitorReports.companyId, companyId))
      .orderBy(desc(janitorReports.startedAt))
      .limit(limit);
    res.json({ reports: rows });
  });

  router.get("/companies/:companyId/janitor/reports/:id", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    const id = pickPathId(req.params.id);
    if (!companyId || !id) {
      res.status(400).json({ error: "companyId and id required" });
      return;
    }
    const [row] = await db
      .select()
      .from(janitorReports)
      .where(and(eq(janitorReports.companyId, companyId), eq(janitorReports.id, id)))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "report not found" });
      return;
    }
    res.json(row);
  });

  router.get("/companies/:companyId/janitor/outages", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const statusFilter = typeof req.query.status === "string" ? req.query.status.trim() : "";
    let query = db
      .select()
      .from(janitorOutages)
      .where(eq(janitorOutages.companyId, companyId))
      .$dynamic();
    if (statusFilter === "open") {
      query = db
        .select()
        .from(janitorOutages)
        .where(and(eq(janitorOutages.companyId, companyId), eq(janitorOutages.status, "open")))
        .$dynamic();
    } else if (statusFilter === "resolved") {
      query = db
        .select()
        .from(janitorOutages)
        .where(and(eq(janitorOutages.companyId, companyId), eq(janitorOutages.status, "resolved")))
        .$dynamic();
    }
    const rows = await query.orderBy(desc(janitorOutages.detectedAt)).limit(100);
    res.json({ outages: rows });
  });

  router.get("/companies/:companyId/janitor/outages/:id", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    const id = pickPathId(req.params.id);
    if (!companyId || !id) {
      res.status(400).json({ error: "companyId and id required" });
      return;
    }
    const [row] = await db
      .select()
      .from(janitorOutages)
      .where(and(eq(janitorOutages.companyId, companyId), eq(janitorOutages.id, id)))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "outage not found" });
      return;
    }
    res.json(row);
  });

  router.post("/companies/:companyId/janitor/outages/:id/resolve", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    const id = pickPathId(req.params.id);
    if (!companyId || !id) {
      res.status(400).json({ error: "companyId and id required" });
      return;
    }
    const [updated] = await db
      .update(janitorOutages)
      .set({ status: "resolved", resolvedAt: new Date() })
      .where(and(eq(janitorOutages.companyId, companyId), eq(janitorOutages.id, id)))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "outage not found" });
      return;
    }
    res.json(updated);
  });

  router.get("/companies/:companyId/janitor/paused-agents", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const rows = await listJanitorPausedAgents(db, companyId);
    res.json({ agents: rows });
  });

  router.get("/companies/:companyId/janitor/identity", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const [hank] = await db
      .select()
      .from(agents)
      .where(and(eq(agents.companyId, companyId), eq(agents.roleTemplateKey, "eng.plug_in_janitor")))
      .limit(1);
    res.json({ janitor: hank ?? null });
  });

  return router;
}
