import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { panicStopService } from "../services/panic-stop.js";
import type { PluginWorkerManager } from "../services/plugin-worker-manager.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";

// Emergency "everyone stop" lever — pauses every non-terminated agent in
// the company and aborts every in-flight heartbeat run. Wired to a
// Sidebar button so the operator can hit it instantly when the machine
// is being pushed beyond its PSU / thermal envelope.

export function panicStopRoutes(
  db: Db,
  options: { pluginWorkerManager?: PluginWorkerManager } = {},
) {
  const router = Router();
  const svc = panicStopService(db, { pluginWorkerManager: options.pluginWorkerManager });

  router.post("/companies/:companyId/panic-stop", async (req: Request, res: Response) => {
    const companyId = req.params.companyId as string;
    if (!companyId) {
      res.status(400).json({ error: "Missing companyId" });
      return;
    }
    assertCompanyAccess(req, companyId);

    const actor = getActorInfo(req);
    const result = await svc.execute({
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
    });

    res.json(result);
  });

  return router;
}
