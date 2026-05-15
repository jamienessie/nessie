import { Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { agentBusMessages } from "@nessie/db";
import { busAutoReplyRulesService, type BusAutoReplyAction } from "../services/bus-auto-reply-rules.js";
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

const VALID_ACTIONS: ReadonlySet<BusAutoReplyAction> = new Set(["dismiss", "auto_reply"]);

export function busAutoReplyRulesRoutes(db: Db): Router {
  const router = Router();
  const svc = busAutoReplyRulesService(db);

  router.get("/bus-rules", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const rules = await svc.list(companyId);
    res.json({ rules });
  });

  router.post("/bus-rules", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = pickString(body.name);
    const kind = pickString(body.kind);
    const actionRaw = pickString(body.action);
    if (!name || !kind || !actionRaw || !VALID_ACTIONS.has(actionRaw as BusAutoReplyAction)) {
      res.status(400).json({ error: "name, kind, and action (dismiss|auto_reply) required" });
      return;
    }
    const fromAgentIds = Array.isArray(body.fromAgentIds)
      ? (body.fromAgentIds as unknown[]).filter((v): v is string => typeof v === "string")
      : null;
    const payloadMatch = body.payloadMatch && typeof body.payloadMatch === "object" && !Array.isArray(body.payloadMatch)
      ? (body.payloadMatch as Record<string, unknown>)
      : null;
    const replyTemplate = body.replyTemplate && typeof body.replyTemplate === "object" && !Array.isArray(body.replyTemplate)
      ? (body.replyTemplate as Record<string, unknown>)
      : null;
    const positionRaw = body.position;
    const position = typeof positionRaw === "number" && Number.isFinite(positionRaw) ? positionRaw : 0;
    const enabled = body.enabled !== false;
    const rule = await svc.create({
      companyId,
      name,
      kind,
      fromAgentIds,
      payloadMatch,
      action: actionRaw as BusAutoReplyAction,
      replyTemplate,
      position,
      enabled,
      createdByUserId: actor.actorType === "user" ? actor.actorId : null,
    });
    res.status(201).json({ rule });
  });

  router.patch("/bus-rules/:id", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Parameters<typeof svc.update>[0] = { id: paramId(req, "id"), companyId };
    if (typeof body.name === "string") patch.name = body.name.trim();
    if (typeof body.kind === "string") patch.kind = body.kind.trim();
    if (typeof body.position === "number") patch.position = body.position;
    if (typeof body.enabled === "boolean") patch.enabled = body.enabled;
    if (Array.isArray(body.fromAgentIds)) {
      patch.fromAgentIds = (body.fromAgentIds as unknown[]).filter((v): v is string => typeof v === "string");
    }
    if (body.payloadMatch && typeof body.payloadMatch === "object" && !Array.isArray(body.payloadMatch)) {
      patch.payloadMatch = body.payloadMatch as Record<string, unknown>;
    }
    if (body.replyTemplate && typeof body.replyTemplate === "object" && !Array.isArray(body.replyTemplate)) {
      patch.replyTemplate = body.replyTemplate as Record<string, unknown>;
    }
    if (typeof body.action === "string" && VALID_ACTIONS.has(body.action as BusAutoReplyAction)) {
      patch.action = body.action as BusAutoReplyAction;
    }
    const rule = await svc.update(patch);
    if (!rule) {
      res.status(404).json({ error: "rule not found" });
      return;
    }
    res.json({ rule });
  });

  // Dry-run: given a candidate rule, return the recent messages it
  // WOULD have matched. Doesn't execute the action. Used by the
  // operator before creating / saving the rule.
  router.post("/bus-rules/dryrun", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = pickString(body.kind);
    if (!kind) {
      res.status(400).json({ error: "kind required" });
      return;
    }
    const fromAgentIds = Array.isArray(body.fromAgentIds)
      ? (body.fromAgentIds as unknown[]).filter((v): v is string => typeof v === "string")
      : null;
    const payloadMatch = body.payloadMatch && typeof body.payloadMatch === "object" && !Array.isArray(body.payloadMatch)
      ? (body.payloadMatch as Record<string, unknown>)
      : null;
    const limitRaw = typeof body.limit === "number" ? body.limit : 100;
    const limit = Math.max(1, Math.min(500, Math.floor(limitRaw)));

    const messages = await db
      .select()
      .from(agentBusMessages)
      .where(and(eq(agentBusMessages.companyId, companyId), eq(agentBusMessages.kind, kind)))
      .orderBy(desc(agentBusMessages.createdAt))
      .limit(limit);

    const matched: typeof messages = [];
    for (const m of messages) {
      if (fromAgentIds && fromAgentIds.length > 0) {
        if (!m.fromAgentId || !fromAgentIds.includes(m.fromAgentId)) continue;
      }
      if (payloadMatch) {
        let allMatch = true;
        const payload = (m.payload ?? {}) as Record<string, unknown>;
        for (const [k, v] of Object.entries(payloadMatch)) {
          if (payload[k] !== v) { allMatch = false; break; }
        }
        if (!allMatch) continue;
      }
      matched.push(m);
    }
    res.json({
      windowSize: messages.length,
      matchedCount: matched.length,
      matched: matched.slice(0, 20).map((m) => ({
        id: m.id,
        kind: m.kind,
        fromAgentId: m.fromAgentId,
        toAgentId: m.toAgentId,
        status: m.status,
        payload: m.payload,
        createdAt: m.createdAt.toISOString(),
      })),
    });
  });

  router.delete("/bus-rules/:id", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const ok = await svc.delete({ id: paramId(req, "id"), companyId });
    if (!ok) {
      res.status(404).json({ error: "rule not found" });
      return;
    }
    res.status(204).end();
  });

  return router;
}
