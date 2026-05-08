import { Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import {
  inboxItems,
  operatorConstitution,
  operatorConstitutionVersions,
  trustReceipts,
} from "@nessie/db";

// v0.8 starter pack: Inbox · Operator Constitution · Trust Receipts.
// Mounted at /api. Fully company-scoped via X-Nessie-Company-Id header
// or ?companyId= query param.

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
function pickRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function v0_8Routes(db: Db): Router {
  const router = Router();

  // ----- Inbox (§20.1) -----
  router.get("/inbox", async (req, res) => {
    const companyId = pickCompanyId(req);
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const status = pickString(req.query.status);
    const conditions = [eq(inboxItems.companyId, companyId)];
    if (status) conditions.push(eq(inboxItems.status, status));
    const items = await db.select().from(inboxItems).where(and(...conditions))
      .orderBy(desc(inboxItems.createdAt)).limit(200);
    res.json({ items });
  });

  router.post("/inbox", async (req, res) => {
    const companyId = pickCompanyId(req);
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = pickString(body.kind) ?? "note";
    const [created] = await db.insert(inboxItems).values({
      companyId,
      kind,
      bodyMarkdown: pickString(body.bodyMarkdown),
      refs: Array.isArray(body.refs) ? (body.refs as never) : [],
      status: "captured",
      capturedByUserId: pickString(body.capturedByUserId),
    }).returning();
    res.status(201).json({ item: created });
  });

  router.post("/inbox/:id/triage", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const status = pickString(body.status); // dismissed | saved_as_memory | became_issue | ...
    if (!status) { res.status(400).json({ error: "status required" }); return; }
    const [updated] = await db.update(inboxItems).set({
      status,
      triagedAt: new Date(),
      triagedNotes: pickString(body.notes),
      promotedKind: pickString(body.promotedKind),
      promotedId: pickString(body.promotedId),
      updatedAt: new Date(),
    }).where(eq(inboxItems.id, paramId(req, "id"))).returning();
    res.json({ item: updated });
  });

  // ----- Operator Constitution (§20.46) -----
  router.get("/constitution", async (req, res) => {
    const companyId = pickCompanyId(req);
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const rows = await db.select().from(operatorConstitution).where(eq(operatorConstitution.companyId, companyId)).limit(1);
    res.json({ constitution: rows[0] ?? null });
  });

  router.put("/constitution", async (req, res) => {
    const companyId = pickCompanyId(req);
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const sections = pickRecord(body.sections);
    const note = pickString(body.note);
    return db.transaction(async (tx) => {
      const existingRows = await tx.select().from(operatorConstitution).where(eq(operatorConstitution.companyId, companyId)).limit(1);
      const existing = existingRows[0];
      if (existing) {
        const newVersion = existing.version + 1;
        const [updated] = await tx.update(operatorConstitution).set({
          sections, version: newVersion, updatedAt: new Date(),
          updatedByUserId: pickString(body.updatedByUserId),
        }).where(eq(operatorConstitution.id, existing.id)).returning();
        await tx.insert(operatorConstitutionVersions).values({
          constitutionId: existing.id, version: newVersion,
          sections, note: note ?? null,
          snapshotByUserId: pickString(body.updatedByUserId),
        });
        res.json({ constitution: updated });
      } else {
        const [created] = await tx.insert(operatorConstitution).values({
          companyId, sections, version: 1,
          updatedByUserId: pickString(body.updatedByUserId),
        }).returning();
        await tx.insert(operatorConstitutionVersions).values({
          constitutionId: created.id, version: 1,
          sections, note: note ?? null,
          snapshotByUserId: pickString(body.updatedByUserId),
        });
        res.status(201).json({ constitution: created });
      }
    });
  });

  router.get("/constitution/versions", async (req, res) => {
    const companyId = pickCompanyId(req);
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const rows = await db.select().from(operatorConstitution).where(eq(operatorConstitution.companyId, companyId)).limit(1);
    if (!rows[0]) { res.json({ versions: [] }); return; }
    const versions = await db.select().from(operatorConstitutionVersions)
      .where(eq(operatorConstitutionVersions.constitutionId, rows[0].id))
      .orderBy(desc(operatorConstitutionVersions.version));
    res.json({ versions });
  });

  // ----- Trust Receipts (§20.24) -----
  router.get("/trust-receipts", async (req, res) => {
    const scopeKind = pickString(req.query.scopeKind);
    const scopeId = pickString(req.query.scopeId);
    if (!scopeKind || !scopeId) {
      res.status(400).json({ error: "scopeKind and scopeId required" });
      return;
    }
    const rows = await db.select().from(trustReceipts)
      .where(and(eq(trustReceipts.scopeKind, scopeKind), eq(trustReceipts.scopeId, scopeId)))
      .orderBy(desc(trustReceipts.issuedAt));
    res.json({ receipts: rows });
  });

  router.post("/trust-receipts", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scopeKind = pickString(body.scopeKind);
    const scopeId = pickString(body.scopeId);
    const summary = pickString(body.summary);
    if (!scopeKind || !scopeId || !summary) {
      res.status(400).json({ error: "scopeKind, scopeId, summary required" });
      return;
    }
    const [created] = await db.insert(trustReceipts).values({
      scopeKind, scopeId, summary,
      body: pickRecord(body.body),
      issuedByUserId: pickString(body.issuedByUserId),
    }).returning();
    res.status(201).json({ receipt: created });
  });

  return router;
}
