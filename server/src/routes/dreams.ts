import { Router } from "express";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { inboxItems, companies as companiesTable, goals as goalsTable } from "@nessie/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/activity-log.js";
import { callNessieProxy } from "../services/llm-call.js";

// Sleep Mode: when the company is idle, agents "dream" — low-priority
// creative riffs on the company goal. Dreams live in `inbox_items` with
// `kind: "dream"`, reusing the existing inbox machinery. This route file
// gives dreams their own surface (list, capture, promote, dismiss) so the
// dashboard widget and Dream Journal can stay narrowly scoped without
// having to filter the generic inbox-items endpoints.

const DREAM_KIND = "dream";
const MAX_DREAM_BODY_LENGTH = 4000;
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 100;

const dreamCaptureSchema = z.object({
  bodyMarkdown: z.string().trim().min(1).max(MAX_DREAM_BODY_LENGTH),
  capturedByAgentId: z.string().uuid().optional().nullable(),
  refs: z
    .array(
      z.object({
        kind: z.string().min(1),
        ref: z.string().min(1),
        summary: z.string().optional(),
      }),
    )
    .optional()
    .default([]),
});

const dreamPromoteSchema = z.object({
  promotedKind: z.enum(["issue", "project", "memory", "war_room"]),
  promotedId: z.string().uuid(),
});

function clampLimit(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.floor(n), MAX_LIST_LIMIT);
}

export function dreamRoutes(db: Db) {
  const router = Router();

  router.get("/companies/:companyId/dreams", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const limit = clampLimit(req.query.limit);
    const rows = await db
      .select()
      .from(inboxItems)
      .where(and(eq(inboxItems.companyId, companyId), eq(inboxItems.kind, DREAM_KIND)))
      .orderBy(desc(inboxItems.createdAt))
      .limit(limit);

    res.json(rows);
  });

  router.post(
    "/companies/:companyId/dreams",
    validate(dreamCaptureSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const actor = getActorInfo(req);

      // Agents post dreams via their API key. Board users post manually when
      // testing or seeding dreams. The capturedBy fields preserve attribution
      // regardless of which path triggered the capture.
      const capturedByAgentId =
        req.body.capturedByAgentId ?? (actor.actorType === "agent" ? actor.agentId : null);
      const capturedByUserId = actor.actorType === "user" ? actor.actorId : null;

      const [row] = await db
        .insert(inboxItems)
        .values({
          companyId,
          kind: DREAM_KIND,
          bodyMarkdown: req.body.bodyMarkdown,
          refs: req.body.refs ?? [],
          status: "captured",
          capturedByAgentId,
          capturedByUserId,
        })
        .returning();

      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "dream.captured",
        entityType: "inbox_item",
        entityId: row.id,
        details: { kind: DREAM_KIND },
      });

      res.status(201).json(row);
    },
  );

  router.post(
    "/companies/:companyId/dreams/:id/promote",
    validate(dreamPromoteSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const id = req.params.id as string;

      const [row] = await db
        .update(inboxItems)
        .set({
          status: req.body.promotedKind === "memory" ? "saved_as_memory" : `became_${req.body.promotedKind}`,
          promotedKind: req.body.promotedKind,
          promotedId: req.body.promotedId,
          triagedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inboxItems.id, id),
            eq(inboxItems.companyId, companyId),
            eq(inboxItems.kind, DREAM_KIND),
          ),
        )
        .returning();

      if (!row) {
        res.status(404).json({ error: "Dream not found" });
        return;
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "dream.promoted",
        entityType: "inbox_item",
        entityId: row.id,
        details: {
          promotedKind: req.body.promotedKind,
          promotedId: req.body.promotedId,
        },
      });

      res.json(row);
    },
  );

  // "Dream now" — operator hits this from the Dream Journal to ask the
  // sleeping company to riff on its goal. Posts a fresh inbox_item dream
  // with the LLM-generated content.
  router.post("/companies/:companyId/dreams/generate", async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const actor = getActorInfo(req);

    const company = await db
      .select({ name: companiesTable.name, description: companiesTable.description })
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId))
      .then((rows) => rows[0] ?? null);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    // Find the top-level goal to give the dream something concrete to riff on.
    const topGoal = await db
      .select({ title: goalsTable.title, description: goalsTable.description })
      .from(goalsTable)
      .where(and(eq(goalsTable.companyId, companyId), eq(goalsTable.level, "company")))
      .limit(1)
      .then((rows) => rows[0] ?? null);

    const llm = await callNessieProxy({
      companyId,
      messages: [
        {
          role: "system",
          content:
            "You are an agent at an autonomous company that has gone idle and is now \"dreaming\" — generating a low-priority creative riff on the company's top-level goal. The dream should feel like an idea worth waking up for: a what-if, a 10x play, a controversial angle, or a pivot worth considering. Output 1-3 paragraphs of plain text. No headers, no bullets, no preamble.",
        },
        {
          role: "user",
          content: `Company: ${company.name}\n${company.description ? `\nDescription: ${company.description}` : ""}${topGoal ? `\n\nTop-level goal: ${topGoal.title}${topGoal.description ? `\n${topGoal.description}` : ""}` : ""}`,
        },
      ],
      temperature: 1.0,
      maxTokens: 400,
    });

    let body: string;
    let source: "llm" | "template" = "template";
    let warning: string | null = null;

    if (llm.ok) {
      body = llm.text;
      source = "llm";
    } else {
      body = `What if ${company.name} did the opposite of what every competitor is doing — would the market notice, or would we just be alone? (Template dream — ${llm.fix})`;
      warning = llm.fix;
    }

    const [row] = await db
      .insert(inboxItems)
      .values({
        companyId,
        kind: DREAM_KIND,
        bodyMarkdown: body,
        refs: topGoal ? [{ kind: "goal", ref: topGoal.title, summary: topGoal.title }] : [],
        status: "captured",
        capturedByAgentId: null,
        capturedByUserId: actor.actorType === "user" ? actor.actorId : null,
      })
      .returning();

    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "dream.captured",
      entityType: "inbox_item",
      entityId: row.id,
      details: { kind: DREAM_KIND, source, autoGenerated: true },
    });

    res.status(201).json({ dream: row, source, warning });
  });

  router.post(
    "/companies/:companyId/dreams/:id/dismiss",
    async (req, res) => {
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);
      const id = req.params.id as string;

      const [row] = await db
        .update(inboxItems)
        .set({
          status: "dismissed",
          triagedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inboxItems.id, id),
            eq(inboxItems.companyId, companyId),
            eq(inboxItems.kind, DREAM_KIND),
          ),
        )
        .returning();

      if (!row) {
        res.status(404).json({ error: "Dream not found" });
        return;
      }

      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        runId: actor.runId,
        action: "dream.dismissed",
        entityType: "inbox_item",
        entityId: row.id,
        details: null,
      });

      res.json(row);
    },
  );

  return router;
}
