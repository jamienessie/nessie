import { Router } from "express";
import type { Db } from "@nessie/db";
import { assertBoard, getActorInfo } from "./authz.js";
import { clipmartService } from "../services/clipmart.js";

// ClipMart — read-only catalog + "fork into my instance". MVP serves an
// in-process catalog. The catalog hand-off step is intentionally minimal
// so this route can be repointed at a real registry (GitHub-hosted JSON +
// tarballs) without touching the UI.

export function clipmartRoutes(db: Db) {
  const router = Router();
  const svc = clipmartService(db);

  router.get("/clipmart/catalog", (_req, res) => {
    res.json({ entries: svc.list() });
  });

  router.get("/clipmart/entry/:slug", (req, res) => {
    const slug = req.params.slug as string;
    const entry = svc.get(slug);
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    res.json(entry);
  });

  router.post("/clipmart/fork/:slug", async (req, res) => {
    assertBoard(req);
    const slug = req.params.slug as string;
    const actor = getActorInfo(req);
    try {
      const result = await svc.fork(slug, { actorType: actor.actorType, actorId: actor.actorId });
      res.status(201).json(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Fork failed";
      res.status(400).json({ error: message });
    }
  });

  return router;
}
