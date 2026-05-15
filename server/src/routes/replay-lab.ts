import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { replayLabService } from "../services/replay-lab.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

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

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function replayLabRoutes(db: Db): Router {
  const router = Router();
  const svc = replayLabService(db);

  router.post("/replay/runs", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const overrideModel = pickString(body.overrideModel);
    const overridePrompt = pickString(body.overridePrompt);
    const overrideSystemPrompt = pickString(body.overrideSystemPrompt);
    const originalRunId = pickString(body.originalRunId);
    if (!overrideModel || !overridePrompt) {
      res.status(400).json({ error: "overrideModel and overridePrompt required" });
      return;
    }
    try {
      const replay = await svc.replay({
        companyId,
        originalRunId,
        overrideModel,
        overridePrompt,
        overrideSystemPrompt,
        requestedByUserId: actor.actorType === "user" ? actor.actorId : null,
      });
      res.status(201).json({ replay });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "replay failed" });
    }
  });

  router.get("/replay/runs", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : undefined;
    const replays = await svc.list(companyId, { limit });
    res.json({ replays });
  });

  router.get("/replay/runs/:id", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const result = await svc.get(paramId(req, "id"), companyId);
    if (!result) {
      res.status(404).json({ error: "replay not found" });
      return;
    }
    res.json(result);
  });

  return router;
}
