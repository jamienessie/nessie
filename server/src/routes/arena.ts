import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { arenaService, type ArenaRunStatus } from "../services/arena-service.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

function pickCompanyId(req: Request): string | null {
  const fromHeader = req.header("x-nessie-company-id")?.trim();
  if (fromHeader) return fromHeader;
  const fromQuery = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
  if (fromQuery) return fromQuery;
  const fromBody = req.body && typeof req.body === "object" && typeof (req.body as Record<string, unknown>).companyId === "string"
    ? ((req.body as Record<string, unknown>).companyId as string).trim()
    : "";
  return fromBody || null;
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function paramId(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : (value ?? "");
}

function pickStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string" || !v.trim()) return null;
    out.push(v.trim());
  }
  return out;
}

const VALID_STATUSES: ReadonlySet<ArenaRunStatus> = new Set([
  "running",
  "judged",
  "cancelled",
  "failed",
]);

export function arenaRoutes(db: Db): Router {
  const router = Router();
  const svc = arenaService(db);

  router.post("/arena/runs", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const taskType = pickString(body.taskType);
    const prompt = pickString(body.prompt);
    const candidateModels = pickStringArray(body.candidateModels);
    const judgeModel = pickString(body.judgeModel) ?? undefined;
    if (!taskType || !prompt || !candidateModels) {
      res.status(400).json({ error: "taskType, prompt, candidateModels required" });
      return;
    }
    const result = await svc.create({
      companyId,
      taskType,
      prompt,
      candidateModels,
      judgeModel,
      requestedByUserId: actor.actorType === "user" ? actor.actorId : null,
      requestedByAgentId: actor.actorType === "agent" ? actor.agentId : null,
    });
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    const run = await svc.get(result.runId, companyId);
    res.status(201).json({ run });
  });

  router.get("/arena/runs", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const taskType = pickString(req.query.taskType) ?? undefined;
    const statusRaw = pickString(req.query.status);
    const status = statusRaw && VALID_STATUSES.has(statusRaw as ArenaRunStatus)
      ? (statusRaw as ArenaRunStatus)
      : undefined;
    const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : undefined;
    const runs = await svc.list(companyId, { taskType, status, limit });
    res.json({ runs });
  });

  router.get("/arena/leaderboard", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const taskType = pickString(req.query.taskType) ?? undefined;
    const entries = await svc.leaderboard(companyId, { taskType });
    res.json({ entries });
  });

  router.get("/arena/runs/:id", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const run = await svc.get(paramId(req, "id"), companyId);
    if (!run) {
      res.status(404).json({ error: "arena run not found" });
      return;
    }
    res.json({ run });
  });

  router.post("/arena/runs/:id/cancel", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const result = await svc.cancel(paramId(req, "id"), {
      actorType: actor.actorType,
      actorId: actor.actorId,
    });
    if (!result.ok && result.status !== "cancelled") {
      res.status(409).json({ error: `cannot cancel a run in status ${result.status}` });
      return;
    }
    const run = await svc.get(paramId(req, "id"), companyId);
    res.json({ run });
  });

  return router;
}
