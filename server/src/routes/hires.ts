import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { hiresService, type HireState } from "../services/hires.js";

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
    try {
      const hire = await svc.transitionHire(companyId, paramId(req, "id"), to);
      res.json({ hire });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(409).json({ error: message });
    }
  });

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
    const updated = await svc.setCandidateStatus(paramId(req, "id"), to as never);
    if (!updated) {
      res.status(404).json({ error: "candidate not found" });
      return;
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
    const scorecard = await svc.addScorecard({
      candidateId: paramId(req, "id"),
      pass,
      rubric: body.rubric as Array<{ criterion: string; weight: number; score: number; note?: string }>,
      recommendation: pickString(body.recommendation) as
        | "strong_hire" | "hire" | "weak_hire" | "no_hire" | "strong_no_hire"
        | null
        ?? undefined,
      notes: pickString(body.notes),
    });
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
      const agent = await svc.mintHiredAgent({
        companyId,
        hireId,
        candidateId: paramId(req, "id"),
        finalFirstName: first,
        finalLastName: last,
        finalTitle: title,
        finalTier: tier,
        finalAdapterType: adapter,
        finalDepartmentId: pickString(body.finalDepartmentId),
        finalAutonomyLevel: typeof body.finalAutonomyLevel === "number" ? body.finalAutonomyLevel : undefined,
        roleTemplateKey: pickString(body.roleTemplateKey),
      });
      res.status(201).json({ agent });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(409).json({ error: message });
    }
  });

  return router;
}
