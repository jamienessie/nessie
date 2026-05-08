import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { disasterRecoveryService } from "../services/disaster-recovery.js";

// Operator-only REST surface for Disaster Recovery. Same operations
// as the CLI command, useful when running Nessie remotely (Tailnet).

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function disasterRecoveryRoutes(db: Db): Router {
  const router = Router();
  const svc = disasterRecoveryService(db);

  router.post("/disaster/export", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const outDir = pickString(body.outDir);
    if (!outDir) { res.status(400).json({ error: "outDir required" }); return; }
    const secrets = pickString(body.secrets) === "include" ? "include" : "exclude";
    try {
      const manifest = await svc.exportAll({ outDir, secrets: secrets as "include" | "exclude" });
      res.status(201).json({ manifest });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/disaster/verify", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const inDir = pickString(body.inDir);
    if (!inDir) { res.status(400).json({ error: "inDir required" }); return; }
    const result = await svc.verify(inDir);
    res.json(result);
  });

  return router;
}
