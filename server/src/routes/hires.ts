import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { candidates, hires } from "@nessie/db";
import { eq } from "drizzle-orm";
import { hiresService, type HireState } from "../services/hires.js";
import {
  ensureHrAgent,
  generateCandidates,
  synthesizeScorecard,
} from "../services/hr-orchestrator.js";
import { meetingsService } from "../services/meetings.js";
import { logActivity } from "../services/activity-log.js";
import { getActorInfo } from "./authz.js";

// HR pipeline REST surface. Mounted at /api.

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

export function hireRoutes(db: Db): Router {
  const router = Router();
  const svc = hiresService(db);

  async function resolveCompanyForCandidate(candidateId: string): Promise<string | null> {
    const rows = await db
      .select({ companyId: hires.companyId })
      .from(candidates)
      .innerJoin(hires, eq(candidates.hireId, hires.id))
      .where(eq(candidates.id, candidateId))
      .limit(1);
    return rows[0]?.companyId ?? null;
  }

  // -----------------------------------------------------------------
  // role_templates (catalog)
  // -----------------------------------------------------------------
  router.get("/role-templates", async (_req: Request, res: Response) => {
    const templates = await svc.listRoleTemplates();
    res.json({ templates });
  });

  // Optionally seed against a company. Idempotent.
  router.post("/role-templates/seed", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const result = await svc.seedRoleTemplates(companyId);
    res.json(result);
  });

  // -----------------------------------------------------------------
  // hires
  // -----------------------------------------------------------------
  router.get("/hires", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const status = pickString(req.query.status) as HireState | null;
    const rows = await svc.listHires(companyId, status ? { status } : undefined);
    res.json({ hires: rows });
  });

  router.get("/hires/:id", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const hire = await svc.getHire(companyId, paramId(req, "id"));
    if (!hire) {
      res.status(404).json({ error: "hire not found" });
      return;
    }
    const cands = await svc.listCandidates(hire.id);
    res.json({ hire, candidates: cands });
  });

  router.post("/hires", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const title = pickString(body.title);
    if (!title) {
      res.status(400).json({ error: "title required" });
      return;
    }
    const tier = pickString(body.requestedTier);
    if (tier && !["T1", "T2", "T3"].includes(tier)) {
      res.status(400).json({ error: "requestedTier must be T1|T2|T3" });
      return;
    }
    const hire = await svc.createHire({
      companyId,
      title,
      description: pickString(body.description),
      requestedRoleTemplateKey: pickString(body.requestedRoleTemplateKey),
      requestedDepartmentId: pickString(body.requestedDepartmentId),
      requestedTier: (tier as "T1" | "T2" | "T3" | null) ?? undefined,
      packet: body.packet && typeof body.packet === "object" && !Array.isArray(body.packet)
        ? (body.packet as Record<string, unknown>)
        : undefined,
    });
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      action: "hire.created",
      entityType: "hire",
      entityId: hire.id,
      details: { title: hire.title, requestedTier: tier ?? null },
    });
    res.status(201).json({ hire });
  });

  router.post("/hires/:id/transition", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const to = pickString((req.body ?? {}).to) as HireState | null;
    if (!to) {
      res.status(400).json({ error: "to required" });
      return;
    }
    const hireId = paramId(req, "id");
    try {
      const before = await svc.getHire(companyId, hireId);
      const hire = await svc.transitionHire(companyId, hireId, to);
      // Auto-generate candidates on first entry to `sourcing`. Fire-and-
      // forget so the operator gets the transition response immediately.
      if (to === "sourcing") {
        const existing = await svc.listCandidates(hireId);
        if (existing.length === 0) {
          void generateCandidates({ db, companyId, hireId, count: 3 })
            .then((result) => {
              if (!result.ok) {
                console.warn(`[hires] auto-generate candidates failed for ${hireId}: ${result.error}`);
              } else {
                console.log(`[hires] auto-generated ${result.created.length} candidates for hire ${hireId}`);
              }
            })
            .catch((err) => console.error("[hires] auto-generate threw", err));
        }
      }
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "hire.transitioned",
        entityType: "hire",
        entityId: hire.id,
        details: { from: before?.status ?? null, to },
      });
      res.json({ hire });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(409).json({ error: message });
    }
  });

  // -----------------------------------------------------------------
  // AI-driven HR endpoints (powered by hr-orchestrator + Lena Park)
  // -----------------------------------------------------------------

  /** Manually re-run candidate generation for a hire (e.g., to add more). */
  router.post("/hires/:id/generate-candidates", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const count = typeof body.count === "number" && body.count > 0 ? Math.min(body.count, 8) : 3;
    const result = await generateCandidates({
      db,
      companyId,
      hireId: paramId(req, "id"),
      count,
    });
    if (!result.ok) {
      res.status(502).json({ error: result.error });
      return;
    }
    res.status(201).json({ candidates: result.created });
  });

  /**
   * Spawn an interview meeting for a candidate. Lena Park hosts; the
   * candidate joins as a `candidate`-role participant; optional panel
   * agents (e.g., the CTO for an engineering role) can be added by the
   * caller. Returns the new meeting id so the UI can navigate into the
   * room.
   */
  router.post(
    "/hires/:hireId/candidates/:candidateId/start-interview",
    async (req: Request, res: Response) => {
      const companyId = pickCompanyId(req);
      if (!companyId) {
        res.status(400).json({ error: "companyId required" });
        return;
      }
      const hireId = paramId(req, "hireId");
      const candidateId = paramId(req, "candidateId");
      const body = (req.body ?? {}) as Record<string, unknown>;
      const panelAgentIds = Array.isArray(body.panelAgentIds)
        ? (body.panelAgentIds as unknown[]).filter((s): s is string => typeof s === "string")
        : [];

      const hire = await svc.getHire(companyId, hireId);
      if (!hire) {
        res.status(404).json({ error: "hire not found" });
        return;
      }
      const cands = await svc.listCandidates(hireId);
      const candidate = cands.find((c) => c.id === candidateId);
      if (!candidate) {
        res.status(404).json({ error: "candidate not found" });
        return;
      }

      const hrAgentId = await ensureHrAgent(db, companyId);
      const meetingsApiSvc = meetingsService(db);
      const meeting = await meetingsApiSvc.create({
        companyId,
        title: `Interview: ${candidate.humanFirstName} ${candidate.humanLastName} for ${hire.title}`,
        mode: "interview",
        agendaMarkdown: hire.description ?? `Interview for the role of ${hire.title}.`,
        facilitatorAgentId: hrAgentId,
        turnLimit: 12,
      });
      // Add Lena (host), candidate, and any panel agents.
      await meetingsApiSvc.addParticipant(meeting.id, { agentId: hrAgentId }, "host");
      await meetingsApiSvc.addParticipant(meeting.id, { candidateId }, "candidate");
      for (const panelId of panelAgentIds) {
        if (panelId === hrAgentId) continue;
        await meetingsApiSvc.addParticipant(meeting.id, { agentId: panelId }, "interviewer");
      }
      // Mark the candidate as interviewing.
      await svc.setCandidateStatus(candidateId, "interviewing");
      res.status(201).json({ meetingId: meeting.id });
    },
  );

  /**
   * After an interview meeting wraps, ask Lena to write a rubric scorecard
   * from the transcript. Operator can advance/reject the candidate based
   * on the scorecard's recommendation.
   */
  router.post(
    "/hires/:hireId/candidates/:candidateId/synthesize-scorecard",
    async (req: Request, res: Response) => {
      const companyId = pickCompanyId(req);
      if (!companyId) {
        res.status(400).json({ error: "companyId required" });
        return;
      }
      const body = (req.body ?? {}) as Record<string, unknown>;
      const meetingId = pickString(body.meetingId);
      if (!meetingId) {
        res.status(400).json({ error: "meetingId required" });
        return;
      }
      const result = await synthesizeScorecard({
        db,
        companyId,
        hireId: paramId(req, "hireId"),
        candidateId: paramId(req, "candidateId"),
        meetingId,
      });
      if (!result.ok) {
        res.status(502).json({ error: result.error });
        return;
      }
      res.status(201).json({ scorecard: result.scorecard });
    },
  );

  // -----------------------------------------------------------------
  // candidates
  // -----------------------------------------------------------------
  router.post("/hires/:id/candidates", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const first = pickString(body.humanFirstName);
    const last = pickString(body.humanLastName);
    const title = pickString(body.title);
    if (!first || !last || !title) {
      res.status(400).json({ error: "humanFirstName, humanLastName, and title are required" });
      return;
    }
    const candidate = await svc.addCandidate({
      hireId: paramId(req, "id"),
      humanFirstName: first,
      humanLastName: last,
      title,
      summary: pickString(body.summary),
      resumeMarkdown: pickString(body.resumeMarkdown),
      sourceTemplateKey: pickString(body.sourceTemplateKey),
      proposedAdapterType: pickString(body.proposedAdapterType),
    });
    res.status(201).json({ candidate });
  });

  router.post("/candidates/:id/status", async (req: Request, res: Response) => {
    const to = pickString((req.body ?? {}).to);
    if (!to) {
      res.status(400).json({ error: "to required" });
      return;
    }
    const candidateId = paramId(req, "id");
    const updated = await svc.setCandidateStatus(candidateId, to as never);
    if (!updated) {
      res.status(404).json({ error: "candidate not found" });
      return;
    }
    const companyId = await resolveCompanyForCandidate(candidateId);
    if (companyId) {
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "candidate.status_changed",
        entityType: "candidate",
        entityId: candidateId,
        details: { to },
      });
    }
    res.json({ candidate: updated });
  });

  router.post("/candidates/:id/scorecards", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const pass = pickString(body.pass) as "interview" | "trial" | "final" | null;
    if (!pass || !["interview", "trial", "final"].includes(pass)) {
      res.status(400).json({ error: "pass must be interview | trial | final" });
      return;
    }
    if (!Array.isArray(body.rubric)) {
      res.status(400).json({ error: "rubric must be an array of {criterion, weight, score, note?}" });
      return;
    }
    const candidateId = paramId(req, "id");
    const scorecard = await svc.addScorecard({
      candidateId,
      pass,
      rubric: body.rubric as Array<{ criterion: string; weight: number; score: number; note?: string }>,
      recommendation: pickString(body.recommendation) as
        | "strong_hire" | "hire" | "weak_hire" | "no_hire" | "strong_no_hire"
        | null
        ?? undefined,
      notes: pickString(body.notes),
    });
    const companyId = await resolveCompanyForCandidate(candidateId);
    if (companyId) {
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "candidate.scorecard_added",
        entityType: "scorecard",
        entityId: scorecard.id,
        details: { candidateId, pass, recommendation: scorecard.recommendation },
      });
    }
    res.status(201).json({ scorecard });
  });

  router.get("/candidates/:id/scorecards", async (req: Request, res: Response) => {
    const rows = await svc.listScorecards(paramId(req, "id"));
    res.json({ scorecards: rows });
  });

  router.post("/candidates/:id/hire", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const hireId = pickString(body.hireId);
    const first = pickString(body.finalFirstName);
    const last = pickString(body.finalLastName);
    const title = pickString(body.finalTitle);
    const tier = pickString(body.finalTier) as "T1" | "T2" | "T3" | null;
    const adapter = pickString(body.finalAdapterType);
    if (!hireId || !first || !last || !title || !tier || !adapter) {
      res.status(400).json({ error: "hireId, finalFirstName, finalLastName, finalTitle, finalTier, finalAdapterType all required" });
      return;
    }
    if (!["T1", "T2", "T3"].includes(tier)) {
      res.status(400).json({ error: "finalTier must be T1|T2|T3" });
      return;
    }
    try {
      const candidateId = paramId(req, "id");
      const agent = await svc.mintHiredAgent({
        companyId,
        hireId,
        candidateId,
        finalFirstName: first,
        finalLastName: last,
        finalTitle: title,
        finalTier: tier,
        finalAdapterType: adapter,
        finalDepartmentId: pickString(body.finalDepartmentId),
        finalAutonomyLevel: typeof body.finalAutonomyLevel === "number" ? body.finalAutonomyLevel : undefined,
        roleTemplateKey: pickString(body.roleTemplateKey),
      });
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        agentId: actor.agentId,
        action: "candidate.minted",
        entityType: "agent",
        entityId: agent.id,
        details: { hireId, candidateId, finalTitle: title, finalTier: tier },
      });
      res.status(201).json({ agent });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(409).json({ error: message });
    }
  });

  return router;
}
