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
import { publishLiveEvent } from "./live-events.js";
import { blackBoxRecorder } from "./black-box.js";

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
    publishLiveEvent({
      companyId,
      type: "meeting.transitioned",
      payload: { meetingId, from, to, meeting: updated },
    });
    await blackBoxRecorder(this.db).record({
      scope: "meeting",
      scopeId: meetingId,
      label: "transitioned",
      snapshot: { from, to },
    });
    return updated;
  }

  async listParticipants(meetingId: string) {
    return this.db
      .select()
      .from(meetingParticipants)
      .where(eq(meetingParticipants.meetingId, meetingId))
      .orderBy(asc(meetingParticipants.joinedAt));
  }

  /**
   * Add a participant to a meeting. Speaker is either an existing agent
   * or a hiring-pipeline candidate persona — exactly one of `agentId`
   * and `candidateId` must be set (DB CHECK constraint enforces this).
   */
  async addParticipant(
    meetingId: string,
    speaker: { agentId: string; candidateId?: undefined } | { agentId?: undefined; candidateId: string },
    role: string = "panel",
  ) {
    if (speaker.agentId) {
      const [created] = await this.db
        .insert(meetingParticipants)
        .values({ meetingId, agentId: speaker.agentId, role })
        .onConflictDoNothing({ target: [meetingParticipants.meetingId, meetingParticipants.agentId] })
        .returning();
      if (created) {
        const meeting = await this.getById(meetingId);
        if (meeting) {
          publishLiveEvent({
            companyId: meeting.companyId,
            type: "meeting.participant.added",
            payload: { meetingId, participant: created },
          });
        }
      }
      return created ?? null;
    }
    // candidate path — uses the partial unique on (meetingId, candidateId).
    const [created] = await this.db
      .insert(meetingParticipants)
      .values({ meetingId, candidateId: speaker.candidateId, role })
      .onConflictDoNothing({ target: [meetingParticipants.meetingId, meetingParticipants.candidateId] })
      .returning();
    if (created) {
      const meeting = await this.getById(meetingId);
      if (meeting) {
        publishLiveEvent({
          companyId: meeting.companyId,
          type: "meeting.participant.added",
          payload: { meetingId, participant: created },
        });
      }
    }
    return created ?? null;
  }

  /** Internal helper — fetch a meeting by id without scoping by company. */
  async getById(meetingId: string) {
    const rows = await this.db.select().from(meetings).where(eq(meetings.id, meetingId)).limit(1);
    return rows[0] ?? null;
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
    const result = await this.db.transaction(async (tx) => {
      const [updatedMeeting] = await tx
        .update(meetings)
        .set({
          turnIndex: sql`${meetings.turnIndex} + 1`,
          spentCents: sql`${meetings.spentCents} + ${input.costCents ?? 0}`,
          updatedAt: new Date(),
        })
        .where(eq(meetings.id, input.meetingId))
        .returning({ turnIndex: meetings.turnIndex, companyId: meetings.companyId });
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
      return { msg, companyId: updatedMeeting.companyId };
    });
    publishLiveEvent({
      companyId: result.companyId,
      type: "meeting.message.added",
      payload: { meetingId: input.meetingId, message: result.msg },
    });
    return result.msg;
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
    const meeting = await this.getById(input.meetingId);
    if (meeting) {
      publishLiveEvent({
        companyId: meeting.companyId,
        type: "meeting.outcome.added",
        payload: { meetingId: input.meetingId, outcome: created },
      });
    }
    return created;
  }

  async approveOutcome(outcomeId: string) {
    const [updated] = await this.db
      .update(meetingOutcomes)
      .set({ approvedByOperator: true, approvedAt: new Date(), updatedAt: new Date() })
      .where(eq(meetingOutcomes.id, outcomeId))
      .returning();
    if (updated) {
      const meeting = await this.getById(updated.meetingId);
      if (meeting) {
        publishLiveEvent({
          companyId: meeting.companyId,
          type: "meeting.outcome.approved",
          payload: { meetingId: updated.meetingId, outcome: updated },
        });
        await blackBoxRecorder(this.db).record({
          scope: "meeting",
          scopeId: updated.meetingId,
          label: "outcome_approved",
          snapshot: { outcomeId: updated.id, kind: updated.kind },
        });
      }
    }
    return updated;
  }

  // Apply ready outcomes for a meeting: fire real side-effects (issue
  // creation for ACTION/ISSUE, decision-record commit for DECIDE) and
  // stamp appliedAt + appliedRef on each row.
  async applyReadyOutcomes(meetingId: string): Promise<{ applied: number; skipped: number }> {
    const meeting = await this.getById(meetingId);
    if (!meeting) return { applied: 0, skipped: 0 };
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
      const result = await applyOutcomeEffects(
        this.db,
        {
          kind: row.kind as MeetingOutcomeKind,
          payload: row.payload,
        },
        {
          companyId: meeting.companyId,
          meetingId,
          outcomeId: row.id,
        },
      );
      if (result.applied) {
        const mergedPayload = result.ref
          ? { ...row.payload, appliedRef: result.ref }
          : row.payload;
        await this.db
          .update(meetingOutcomes)
          .set({ appliedAt: new Date(), updatedAt: new Date(), payload: mergedPayload })
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
