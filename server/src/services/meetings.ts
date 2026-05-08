import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@nessie/db";
import {
  meetings,
  meetingParticipants,
  meetingMessages,
  meetingOutcomes,
} from "@nessie/db";
import {
  applyOutcomeEffects,
  isOutcomeReadyToApply,
  outcomeRequiresApproval,
  type MeetingOutcomeKind,
} from "./meeting-write-policy.js";

// Meetings service.
//
// Owns the lifecycle state machine, append-only message log, and outcome
// gating for Meetings. Read paths (list/get) are simple Drizzle queries;
// write paths (transition, addMessage, addOutcome, approveOutcome)
// validate state transitions and budget caps.
//
// The orchestration that wakes participants between turns hooks into the
// existing heartbeat scheduler in Phase 6 -- in this v1 the operator
// drives turns explicitly via POST .../messages.

// Allowed mode strings (free-form text in the column for forward
// compatibility; the service refuses unknown values on insert).
export const MEETING_MODES = [
  "operator_led",
  "facilitator_led",
  "roundtable",
  "debate",
  "silent_first",
  "interview",
  "emergency",
] as const;
export type MeetingMode = (typeof MEETING_MODES)[number];

// Lifecycle state machine.
//   draft           -> preparing | abandoned
//   preparing       -> active | abandoned | failed
//   active          -> waiting_for_operator | synthesizing | abandoned | failed
//   waiting_for_op  -> active | abandoned
//   synthesizing    -> completed | failed
//   completed | abandoned | failed are terminal.
export const MEETING_STATES = [
  "draft",
  "preparing",
  "active",
  "waiting_for_operator",
  "synthesizing",
  "completed",
  "abandoned",
  "failed",
] as const;
export type MeetingState = (typeof MEETING_STATES)[number];

const ALLOWED_TRANSITIONS: Record<MeetingState, ReadonlySet<MeetingState>> = {
  draft: new Set(["preparing", "abandoned"]),
  preparing: new Set(["active", "abandoned", "failed"]),
  active: new Set(["waiting_for_operator", "synthesizing", "abandoned", "failed"]),
  waiting_for_operator: new Set(["active", "abandoned"]),
  synthesizing: new Set(["completed", "failed"]),
  completed: new Set(),
  abandoned: new Set(),
  failed: new Set(),
};

export function canTransition(from: MeetingState, to: MeetingState): boolean {
  return ALLOWED_TRANSITIONS[from].has(to);
}

export interface CreateMeetingInput {
  companyId: string;
  title: string;
  mode?: MeetingMode;
  agendaMarkdown?: string | null;
  departmentId?: string | null;
  facilitatorAgentId?: string | null;
  budgetCents?: number;
  turnLimit?: number;
  scheduledAt?: Date | null;
  createdByAgentId?: string | null;
  createdByUserId?: string | null;
  participantAgentIds?: Array<{ agentId: string; role?: string }>;
}

export class MeetingsService {
  constructor(private readonly db: Db) {}

  async list(companyId: string, opts?: { state?: MeetingState; limit?: number }) {
    const conditions = [eq(meetings.companyId, companyId)];
    if (opts?.state) conditions.push(eq(meetings.state, opts.state));
    return this.db
      .select()
      .from(meetings)
      .where(and(...conditions))
      .orderBy(desc(meetings.scheduledAt), desc(meetings.createdAt))
      .limit(opts?.limit ?? 100);
  }

  async get(companyId: string, meetingId: string) {
    const rows = await this.db
      .select()
      .from(meetings)
      .where(and(eq(meetings.companyId, companyId), eq(meetings.id, meetingId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: CreateMeetingInput) {
    if (input.mode && !MEETING_MODES.includes(input.mode)) {
      throw new Error(`Unknown meeting mode '${input.mode}'`);
    }
    const [created] = await this.db
      .insert(meetings)
      .values({
        companyId: input.companyId,
        title: input.title,
        mode: input.mode ?? "operator_led",
        agendaMarkdown: input.agendaMarkdown ?? null,
        departmentId: input.departmentId ?? null,
        facilitatorAgentId: input.facilitatorAgentId ?? null,
        budgetCents: input.budgetCents ?? 0,
        turnLimit: input.turnLimit ?? 30,
        scheduledAt: input.scheduledAt ?? null,
        createdByAgentId: input.createdByAgentId ?? null,
        createdByUserId: input.createdByUserId ?? null,
        state: "draft",
      })
      .returning();
    if (input.participantAgentIds && input.participantAgentIds.length > 0) {
      await this.db.insert(meetingParticipants).values(
        input.participantAgentIds.map((p) => ({
          meetingId: created.id,
          agentId: p.agentId,
          role: p.role ?? "panel",
        })),
      );
    }
    return created;
  }

  async transition(companyId: string, meetingId: string, to: MeetingState) {
    const existing = await this.get(companyId, meetingId);
    if (!existing) throw new Error(`Meeting ${meetingId} not found`);
    const from = existing.state as MeetingState;
    if (!canTransition(from, to)) {
      throw new Error(`Illegal meeting transition: ${from} -> ${to}`);
    }
    const now = new Date();
    const patch: Record<string, unknown> = { state: to, updatedAt: now };
    if (to === "active" && !existing.startedAt) patch.startedAt = now;
    if (to === "completed" || to === "abandoned" || to === "failed") {
      patch.endedAt = now;
    }
    const [updated] = await this.db
      .update(meetings)
      .set(patch)
      .where(and(eq(meetings.companyId, companyId), eq(meetings.id, meetingId)))
      .returning();
    return updated;
  }

  async listParticipants(meetingId: string) {
    return this.db
      .select()
      .from(meetingParticipants)
      .where(eq(meetingParticipants.meetingId, meetingId))
      .orderBy(asc(meetingParticipants.joinedAt));
  }

  async addParticipant(meetingId: string, agentId: string, role: string = "panel") {
    const [created] = await this.db
      .insert(meetingParticipants)
      .values({ meetingId, agentId, role })
      .onConflictDoNothing({ target: [meetingParticipants.meetingId, meetingParticipants.agentId] })
      .returning();
    return created ?? null;
  }

  async listMessages(meetingId: string, opts?: { limit?: number; afterTurnIndex?: number }) {
    const conditions = [eq(meetingMessages.meetingId, meetingId)];
    if (typeof opts?.afterTurnIndex === "number") {
      conditions.push(sql`${meetingMessages.turnIndex} > ${opts.afterTurnIndex}`);
    }
    return this.db
      .select()
      .from(meetingMessages)
      .where(and(...conditions))
      .orderBy(asc(meetingMessages.turnIndex), asc(meetingMessages.createdAt))
      .limit(opts?.limit ?? 200);
  }

  async addMessage(input: {
    meetingId: string;
    agentId: string | null;
    role: "agent" | "operator" | "system" | "tool";
    bodyMarkdown: string;
    toolCalls?: Array<Record<string, unknown>>;
    costCents?: number;
  }) {
    // Atomic: increment meetings.turnIndex, insert message, lift cost.
    return this.db.transaction(async (tx) => {
      const [updatedMeeting] = await tx
        .update(meetings)
        .set({
          turnIndex: sql`${meetings.turnIndex} + 1`,
          spentCents: sql`${meetings.spentCents} + ${input.costCents ?? 0}`,
          updatedAt: new Date(),
        })
        .where(eq(meetings.id, input.meetingId))
        .returning({ turnIndex: meetings.turnIndex });
      const turnIndex = updatedMeeting.turnIndex;
      const [msg] = await tx
        .insert(meetingMessages)
        .values({
          meetingId: input.meetingId,
          agentId: input.agentId,
          turnIndex,
          role: input.role,
          bodyMarkdown: input.bodyMarkdown,
          toolCalls: input.toolCalls ?? [],
          costCents: input.costCents ?? 0,
        })
        .returning();
      return msg;
    });
  }

  async listOutcomes(meetingId: string) {
    return this.db
      .select()
      .from(meetingOutcomes)
      .where(eq(meetingOutcomes.meetingId, meetingId))
      .orderBy(asc(meetingOutcomes.createdAt));
  }

  async addOutcome(input: {
    meetingId: string;
    kind: MeetingOutcomeKind;
    payload: Record<string, unknown>;
  }) {
    const [created] = await this.db
      .insert(meetingOutcomes)
      .values({
        meetingId: input.meetingId,
        kind: input.kind,
        payload: input.payload,
        approvedByOperator: !outcomeRequiresApproval(input.kind),
      })
      .returning();
    return created;
  }

  async approveOutcome(outcomeId: string) {
    const [updated] = await this.db
      .update(meetingOutcomes)
      .set({ approvedByOperator: true, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(meetingOutcomes.id, outcomeId))
      .returning();
    return updated;
  }

  // Apply ready outcomes for a meeting. Phase 5+ wires real effects;
  // for now this just stamps appliedAt.
  async applyReadyOutcomes(meetingId: string): Promise<{ applied: number; skipped: number }> {
    const rows = await this.listOutcomes(meetingId);
    let applied = 0;
    let skipped = 0;
    for (const row of rows) {
      const ready = isOutcomeReadyToApply(row.kind as MeetingOutcomeKind, {
        approvedByOperator: row.approvedByOperator,
        approvedAt: row.approvedAt,
        appliedAt: row.appliedAt,
      });
      if (!ready) {
        skipped += 1;
        continue;
      }
      const result = await applyOutcomeEffects(this.db, {
        kind: row.kind as MeetingOutcomeKind,
        payload: row.payload,
      });
      if (result.applied) {
        await this.db
          .update(meetingOutcomes)
          .set({ appliedAt: new Date(), updatedAt: new Date() })
          .where(eq(meetingOutcomes.id, row.id));
        applied += 1;
      } else {
        skipped += 1;
      }
    }
    return { applied, skipped };
  }
}

export function meetingsService(db: Db): MeetingsService {
  return new MeetingsService(db);
}
