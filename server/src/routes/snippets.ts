import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { snippetsService } from "../services/snippets.js";
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

export function snippetsRoutes(db: Db): Router {
  const router = Router();
  const svc = snippetsService(db);

  router.get("/snippets", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const items = await svc.list(companyId);
    res.json({ snippets: items });
  });

  router.get("/snippets/:key", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const snippet = await svc.get(companyId, paramId(req, "key"));
    if (!snippet) {
      res.status(404).json({ error: "snippet not found" });
      return;
    }
    res.json({ snippet });
  });

  router.put("/snippets/:key", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = pickString(body.title);
    const noteBody = pickString(body.body);
    const note = pickString(body.note);
    if (!title || !noteBody) {
      res.status(400).json({ error: "title and body required" });
      return;
    }
    try {
      const snippet = await svc.upsert({
        companyId,
        key: paramId(req, "key"),
        title,
        body: noteBody,
        note,
        updatedByUserId: actor.actorType === "user" ? actor.actorId : null,
      });
      res.json({ snippet });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : "upsert failed" });
    }
  });

  router.get("/snippets/:key/revisions", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const revisions = await svc.listRevisions(companyId, paramId(req, "key"));
    res.json({ revisions });
  });

  router.delete("/snippets/:key", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const ok = await svc.delete(companyId, paramId(req, "key"));
    if (!ok) {
      res.status(404).json({ error: "snippet not found" });
      return;
    }
    res.status(204).end();
  });

  return router;
}
