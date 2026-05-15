import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { inboxItems } from "@nessie/db";
import { eq } from "drizzle-orm";
import { inboxItemsService, type InboxStatus } from "../services/inbox-items.js";
import { logActivity } from "../services/activity-log.js";
import { getActorInfo } from "./authz.js";

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function paramId(req: Request, name: string): string {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : (value ?? "");
}
function pickCompanyId(req: Request): string | null {
  const fromHeader = req.header("x-nessie-company-id")?.trim();
  if (fromHeader) return fromHeader;
  const fromQuery = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
  return fromQuery || null;
}

export function inboxItemsRoutes(db: Db): Router {
  const router = Router();
  const svc = inboxItemsService(db);

  router.get("/inbox", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const status = pickString(req.query.status) ?? undefined;
    const items = await svc.list(companyId, { status });
    res.json({ items });
  });

  router.post("/inbox", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const created = await svc.create({
      companyId,
      kind: pickString(body.kind) ?? undefined,
      bodyMarkdown: pickString(body.bodyMarkdown),
      refs: Array.isArray(body.refs) ? body.refs : [],
      capturedByUserId: pickString(body.capturedByUserId),
    });
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "inbox.captured",
      entityType: "inbox_item",
      entityId: created.id,
      details: { kind: created.kind },
    });
    res.status(201).json({ item: created });
  });

  router.post("/inbox/:id/triage", async (req: Request, res: Response) => {
    const itemId = paramId(req, "id");
    const body = (req.body ?? {}) as Record<string, unknown>;
    const status = pickString(body.status) as InboxStatus | null;
    if (!status) { res.status(400).json({ error: "status required" }); return; }
    const updated = await svc.triage(itemId, {
      status,
      notes: pickString(body.notes),
      promotedKind: pickString(body.promotedKind),
      promotedId: pickString(body.promotedId),
    });
    if (!updated) {
      res.status(404).json({ error: "inbox item not found" });
      return;
    }
    const companyRows = await db
      .select({ companyId: inboxItems.companyId })
      .from(inboxItems)
      .where(eq(inboxItems.id, itemId))
      .limit(1);
    const companyId = companyRows[0]?.companyId;
    if (companyId) {
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "inbox.triaged",
        entityType: "inbox_item",
        entityId: itemId,
        details: { status, promotedKind: updated.promotedKind, promotedId: updated.promotedId },
      });
    }
    res.json({ item: updated });
  });

  return router;
}
