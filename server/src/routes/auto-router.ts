import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { agents } from "@nessie/db";
import { resolveAutoRoutedModel } from "../services/auto-router.js";
import { assertCompanyAccess } from "./authz.js";

function pickCompanyId(req: Request): string | null {
  const fromHeader = req.header("x-nessie-company-id")?.trim();
  if (fromHeader) return fromHeader;
  const fromQuery = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
  return fromQuery || null;
}

export function autoRouterRoutes(db: Db): Router {
  const router = Router();

  router.get("/auto-router/preview", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    const agentId = typeof req.query.agentId === "string" ? req.query.agentId.trim() : "";
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    if (!agentId) {
      res.status(400).json({ error: "agentId required" });
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
      .where(eq(agents.id, agentId))
      .limit(1);
    const agent = rows[0];
    if (!agent || agent.companyId !== companyId) {
      res.status(404).json({ error: "agent not found" });
      return;
    }
    const routed = await resolveAutoRoutedModel(db, {
      id: agent.id,
      companyId: agent.companyId,
      role: agent.role,
      runtimeConfig: agent.runtimeConfig as Record<string, unknown> | null,
      adapterConfig: agent.adapterConfig as Record<string, unknown> | null,
      tier: agent.tier,
    });
    res.json({ routed });
  });

  return router;
}
