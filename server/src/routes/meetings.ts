import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { meetingsService, type MeetingMode, type MeetingState } from "../services/meetings.js";
import type { MeetingOutcomeKind } from "../services/meeting-write-policy.js";
import { cancelAutoLoop, startAutoLoop } from "../services/meeting-orchestrator.js";

// Meetings REST surface.
//
// Mounted at /api/meetings. Read paths are open under local_trusted (the
// only deployment mode v1 ships); write paths trust req.actor like every
// other Paperclip route. Phase 5 wires the Cockpit Meetings UI against
// these endpoints; for now they are sufficient for an operator to:
//   - list and inspect meetings
//   - create a meeting + add participants
//   - drive lifecycle transitions
//   - append messages (turn-indexed, atomic with cost rollup)
//   - record outcomes (proposed) and approve them (commit)
//   - apply ready outcomes (no-op effects in v1)

function pickString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function paramId(req: Request, name: string): string {
  // Express params type widens to string | string[] in some setups; path
  // params are always single strings, so coerce.
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : (value ?? "");
}

function pickCompanyId(req: Request): string | null {
  const fromHeader = req.header("x-nessie-company-id")?.trim();
  if (fromHeader) return fromHeader;
  const fromQuery = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
  if (fromQuery) return fromQuery;
  // Local-trusted boot picks the only company the operator has touched.
  return null;
}

export function meetingRoutes(db: Db): Router {
  const router = Router();
  const svc = meetingsService(db);

  router.get("/meetings", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required (header X-Nessie-Company-Id or ?companyId=)" });
      return;
    }
    const state = pickString(req.query.state) as MeetingState | null;
    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const meetings = await svc.list(companyId, {
      state: state ?? undefined,
      limit: Number.isFinite(limit) ? Number(limit) : undefined,
    });
    res.json({ meetings });
  });

  router.get("/meetings/:id", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const meeting = await svc.get(companyId, paramId(req, "id"));
    if (!meeting) {
      res.status(404).json({ error: "meeting not found" });
      return;
    }
    const [participants, messages, outcomes] = await Promise.all([
      svc.listParticipants(meeting.id),
      svc.listMessages(meeting.id),
      svc.listOutcomes(meeting.id),
    ]);
    res.json({ meeting, participants, messages, outcomes });
  });

  router.post("/meetings", async (req: Request, res: Response) => {
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
    try {
      const meeting = await svc.create({
        companyId,
        title,
        mode: pickString(body.mode) as MeetingMode | null ?? undefined,
        agendaMarkdown: pickString(body.agendaMarkdown),
        departmentId: pickString(body.departmentId),
        facilitatorAgentId: pickString(body.facilitatorAgentId),
        budgetCents: typeof body.budgetCents === "number" ? body.budgetCents : undefined,
        turnLimit: typeof body.turnLimit === "number" ? body.turnLimit : undefined,
        scheduledAt: pickString(body.scheduledAt) ? new Date(body.scheduledAt as string) : null,
        participantAgentIds: Array.isArray(body.participants)
          ? (body.participants as Array<{ agentId: string; role?: string }>)
          : undefined,
      });
      res.status(201).json({ meeting });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(400).json({ error: message });
    }
  });

  router.post("/meetings/:id/transition", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const to = pickString((req.body ?? {}).to) as MeetingState | null;
    if (!to) {
      res.status(400).json({ error: "to required" });
      return;
    }
    try {
      const meeting = await svc.transition(companyId, paramId(req, "id"), to);
      // Lifecycle hooks: kick the auto-loop on entry to `active`, cancel it
      // on any other transition (so paused / synthesizing / completed all
      // halt outstanding agent turns).
      if (to === "active") {
        startAutoLoop({ db, companyId, meetingId: meeting.id });
      } else {
        cancelAutoLoop(meeting.id);
      }
      res.json({ meeting });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(409).json({ error: message });
    }
  });

  router.post("/meetings/:id/participants", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const agentId = pickString(body.agentId);
    if (!agentId) {
      res.status(400).json({ error: "agentId required" });
      return;
    }
    const role = pickString(body.role) ?? "panel";
    const created = await svc.addParticipant(paramId(req, "id"), agentId, role);
    res.status(created ? 201 : 200).json({ participant: created });
  });

  router.post("/meetings/:id/messages", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const bodyMarkdown = pickString(body.bodyMarkdown);
    const role = pickString(body.role) as "agent" | "operator" | "system" | "tool" | null;
    if (!bodyMarkdown || !role) {
      res.status(400).json({ error: "bodyMarkdown and role required" });
      return;
    }
    const message = await svc.addMessage({
      meetingId: paramId(req, "id"),
      agentId: pickString(body.agentId),
      role,
      bodyMarkdown,
      toolCalls: Array.isArray(body.toolCalls)
        ? (body.toolCalls as Array<Record<string, unknown>>)
        : undefined,
      costCents: typeof body.costCents === "number" ? body.costCents : undefined,
    });
    res.status(201).json({ message });
  });

  router.post("/meetings/:id/outcomes", async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = pickString(body.kind) as MeetingOutcomeKind | null;
    if (!kind || !["DECIDE", "ACTION", "MEMORY", "ISSUE"].includes(kind)) {
      res.status(400).json({ error: "kind must be DECIDE | ACTION | MEMORY | ISSUE" });
      return;
    }
    const payload = (body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>)
      : {});
    const outcome = await svc.addOutcome({ meetingId: paramId(req, "id"), kind, payload });
    res.status(201).json({ outcome });
  });

  router.post("/meetings/outcomes/:outcomeId/approve", async (req: Request, res: Response) => {
    const outcome = await svc.approveOutcome(paramId(req, "outcomeId"));
    if (!outcome) {
      res.status(404).json({ error: "outcome not found" });
      return;
    }
    res.json({ outcome });
  });

  router.post("/meetings/:id/apply-outcomes", async (req: Request, res: Response) => {
    const result = await svc.applyReadyOutcomes(paramId(req, "id"));
    res.json(result);
  });

  return router;
}
