import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { agentBusService, type BusKind, BUS_KINDS } from "../services/agent-bus.js";
import { workContractsService, type ContractState } from "../services/work-contracts.js";
import { blackBoxRecorder, type BlackBoxScope } from "../services/black-box.js";
import { reputationService, type ReputationDimension, REPUTATION_DIMENSIONS } from "../services/reputation.js";

// Trust-layer REST surface (plan §19). Mounted at /api.
//
//   /bus/messages              — agent-to-agent / operator messages
//   /work-contracts/:issueId   — per-issue contract
//   /black-box?scope=...       — append-only forensic trace
//   /reputation/:agentId       — events + aggregate
//
// All read paths trust req.actor for company scoping (local_trusted
// returns a synthetic operator from the auth middleware).

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

export function trustLayerRoutes(db: Db): Router {
  const router = Router();
  const bus = agentBusService(db);
  const contracts = workContractsService(db);
  const blackBox = blackBoxRecorder(db);
  const reputation = reputationService(db);

  // ----- Agent Bus -----
  router.get("/bus/messages", async (req, res) => {
    const companyId = pickCompanyId(req);
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const kind = pickString(req.query.kind) as BusKind | null;
    const status = pickString(req.query.status);
    const messages = await bus.listForCompany(companyId, {
      kind: kind ?? undefined,
      status: (status as never) ?? undefined,
    });
    res.json({ messages });
  });

  router.post("/bus/messages", async (req, res) => {
    const companyId = pickCompanyId(req);
    if (!companyId) { res.status(400).json({ error: "companyId required" }); return; }
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = pickString(body.kind) as BusKind | null;
    if (!kind || !BUS_KINDS.includes(kind)) {
      res.status(400).json({ error: `kind must be one of ${BUS_KINDS.join("|")}` });
      return;
    }
    const payload = body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
      ? (body.payload as Record<string, unknown>) : {};
    const created = await bus.send({
      companyId,
      fromAgentId: pickString(body.fromAgentId),
      toAgentId: pickString(body.toAgentId),
      kind,
      payload,
      parentMessageId: pickString(body.parentMessageId),
      senderAutonomyLevel: typeof body.senderAutonomyLevel === "number" ? body.senderAutonomyLevel : undefined,
    });
    res.status(201).json({ message: created });
  });

  router.post("/bus/messages/:id/status", async (req, res) => {
    const status = pickString((req.body ?? {}).status);
    if (!status || !["pending", "delivered", "replied", "expired", "dismissed"].includes(status)) {
      res.status(400).json({ error: "status must be pending|delivered|replied|expired|dismissed" });
      return;
    }
    const updated = await bus.markStatus(paramId(req, "id"), status as never);
    res.json({ message: updated });
  });

  // ----- Work Contracts -----
  router.get("/work-contracts/by-issue/:issueId", async (req, res) => {
    const contract = await contracts.getByIssue(paramId(req, "issueId"));
    if (!contract) { res.status(404).json({ error: "no contract for this issue" }); return; }
    res.json({ contract });
  });

  router.post("/work-contracts", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const issueId = pickString(body.issueId);
    if (!issueId) { res.status(400).json({ error: "issueId required" }); return; }
    const contract = await contracts.upsert({
      issueId,
      ownerAgentId: pickString(body.ownerAgentId),
      reviewerAgentId: pickString(body.reviewerAgentId),
      acceptanceCriteria: Array.isArray(body.acceptanceCriteria) ? (body.acceptanceCriteria as never) : undefined,
      evidence: Array.isArray(body.evidence) ? (body.evidence as never) : undefined,
      toolBoundaries: body.toolBoundaries && typeof body.toolBoundaries === "object" ? (body.toolBoundaries as never) : undefined,
      budgetCents: typeof body.budgetCents === "number" ? body.budgetCents : undefined,
      deadlineAt: pickString(body.deadlineAt) ? new Date(body.deadlineAt as string) : null,
      escalationPolicy: body.escalationPolicy && typeof body.escalationPolicy === "object" ? (body.escalationPolicy as never) : undefined,
    });
    res.status(201).json({ contract });
  });

  router.post("/work-contracts/:id/transition", async (req, res) => {
    const to = pickString((req.body ?? {}).to) as ContractState | null;
    if (!to) { res.status(400).json({ error: "to required" }); return; }
    try {
      const contract = await contracts.transition(paramId(req, "id"), to);
      res.json({ contract });
    } catch (err) {
      res.status(409).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post("/work-contracts/:id/evidence", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = pickString(body.kind);
    const ref = pickString(body.ref);
    if (!kind || !ref) { res.status(400).json({ error: "kind and ref required" }); return; }
    const contract = await contracts.addEvidence(paramId(req, "id"), {
      kind,
      ref,
      summary: pickString(body.summary) ?? undefined,
    });
    res.json({ contract });
  });

  // ----- Black Box -----
  router.get("/black-box", async (req, res) => {
    const scope = pickString(req.query.scope) as BlackBoxScope | null;
    const scopeId = pickString(req.query.scopeId);
    if (!scope || !scopeId) {
      res.status(400).json({ error: "scope and scopeId required" });
      return;
    }
    if (!["run", "meeting", "hire", "incident", "decision"].includes(scope)) {
      res.status(400).json({ error: "scope must be run|meeting|hire|incident|decision" });
      return;
    }
    const records = await blackBox.listByScope(scope, scopeId);
    res.json({ records });
  });

  router.post("/black-box", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scope = pickString(body.scope) as BlackBoxScope | null;
    const scopeId = pickString(body.scopeId);
    if (!scope || !scopeId) { res.status(400).json({ error: "scope and scopeId required" }); return; }
    const snapshot = body.snapshot && typeof body.snapshot === "object" && !Array.isArray(body.snapshot)
      ? (body.snapshot as Record<string, unknown>) : {};
    const record = await blackBox.record({
      scope, scopeId,
      label: pickString(body.label),
      snapshot,
    });
    res.status(201).json({ record });
  });

  // ----- Reputation -----
  router.get("/reputation/:agentId", async (req, res) => {
    const events = await reputation.listEvents(paramId(req, "agentId"));
    res.json({ events });
  });

  router.post("/reputation/:agentId/events", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const dimension = pickString(body.dimension) as ReputationDimension | null;
    if (!dimension || !REPUTATION_DIMENSIONS.includes(dimension)) {
      res.status(400).json({ error: `dimension must be one of ${REPUTATION_DIMENSIONS.join("|")}` });
      return;
    }
    const delta = typeof body.delta === "number" ? body.delta : 0;
    const reason = pickString(body.reason);
    if (!reason) { res.status(400).json({ error: "reason required" }); return; }
    const event = await reputation.recordEvent({
      agentId: paramId(req, "agentId"),
      dimension,
      delta,
      reason,
      evidenceRef: pickString(body.evidenceRef) ?? undefined,
      metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
        ? (body.metadata as Record<string, unknown>) : undefined,
    });
    res.status(201).json({ event });
  });

  return router;
}
