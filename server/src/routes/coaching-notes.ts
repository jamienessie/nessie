import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { coachingNotesService } from "../services/coaching-notes.js";
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

function paramId(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : (value ?? "");
}

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function coachingNotesRoutes(db: Db): Router {
  const router = Router();
  const svc = coachingNotesService(db);

  router.get("/agents/:agentId/coaching-notes", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const includeArchived = pickString(req.query.includeArchived) === "true";
    const notes = await svc.list(companyId, paramId(req, "agentId"), { includeArchived });
    res.json({ notes });
  });

  router.post("/agents/:agentId/coaching-notes", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const noteBody = pickString(body.body);
    if (!noteBody) {
      res.status(400).json({ error: "body required" });
      return;
    }
    const positionRaw = body.position;
    const position = typeof positionRaw === "number" && Number.isFinite(positionRaw) ? positionRaw : 0;
    const note = await svc.create({
      companyId,
      agentId: paramId(req, "agentId"),
      body: noteBody,
      position,
      authoredByUserId: actor.actorType === "user" ? actor.actorId : null,
    });
    res.status(201).json({ note });
  });

  router.post("/coaching-notes/:noteId/archive", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const note = await svc.archive({
      companyId,
      noteId: paramId(req, "noteId"),
      archivedByUserId: actor.actorType === "user" ? actor.actorId : null,
    });
    if (!note) {
      res.status(404).json({ error: "note not found" });
      return;
    }
    res.json({ note });
  });

  return router;
}
