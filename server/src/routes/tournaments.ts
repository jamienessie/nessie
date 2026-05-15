import { Router } from "express";
import { z } from "zod";
import type { Db } from "@nessie/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { issueService, logActivity } from "../services/index.js";
import { tournamentService } from "../services/tournaments.js";

// Agent Tournament routes. Storage lives inside `issues.executionState`
// JSONB so no migration is required. Real heartbeat invocation of
// contestants is intentionally deferred — see tournaments.ts.

const startSchema = z.object({
  contestantAgentIds: z.array(z.string().uuid()).min(2).max(8),
  judgeAgentId: z.string().uuid().optional().nullable(),
});

const submitSchema = z.object({
  agentId: z.string().uuid(),
  submission: z.string().min(1).max(8000),
});

const winnerSchema = z.object({
  agentId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
});

export function tournamentRoutes(db: Db) {
  const router = Router();
  const svc = tournamentService(db);
  const issueSvc = issueService(db);

  async function resolveIssue(rawId: string) {
    return (await issueSvc.getByIdentifier(rawId)) ?? (await issueSvc.getById(rawId));
  }

  router.get("/issues/:id/tournament", async (req, res) => {
    const issue = await resolveIssue(req.params.id as string);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const tournament = await svc.get(issue.companyId, issue.id);
    res.json(tournament);
  });

  router.post("/issues/:id/tournament/start", validate(startSchema), async (req, res) => {
    const issue = await resolveIssue(req.params.id as string);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const tournament = await svc.start(issue.companyId, issue.id, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: issue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.tournament_started",
      entityType: "issue",
      entityId: issue.id,
      details: { contestantCount: tournament.contestants.length },
    });
    res.status(201).json(tournament);
  });

  router.post("/issues/:id/tournament/submit", validate(submitSchema), async (req, res) => {
    const issue = await resolveIssue(req.params.id as string);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const tournament = await svc.submit(issue.companyId, issue.id, req.body);
    res.json(tournament);
  });

  router.post("/issues/:id/tournament/winner", validate(winnerSchema), async (req, res) => {
    const issue = await resolveIssue(req.params.id as string);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    const tournament = await svc.pickWinner(issue.companyId, issue.id, req.body);
    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId: issue.companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "issue.tournament_winner_picked",
      entityType: "issue",
      entityId: issue.id,
      details: { winnerAgentId: req.body.agentId },
    });
    res.json(tournament);
  });

  router.post("/issues/:id/tournament/cancel", async (req, res) => {
    const issue = await resolveIssue(req.params.id as string);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    assertCompanyAccess(req, issue.companyId);
    await svc.cancel(issue.companyId, issue.id);
    res.status(204).end();
  });

  return router;
}
