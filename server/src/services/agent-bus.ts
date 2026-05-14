import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { agentBusMessages } from "@nessie/db";
import { canSendBusKindAtLevel, requiresOperatorApproval } from "./agent-permissions.js";

// Agent Bus service. Plan §19. Typed message layer between agents and
// to/from the operator.

export const BUS_KINDS = [
  "handoff",
  "review_request",
  "clarification_request",
  "budget_request",
  "policy_check",
  "meeting_invite",
  "evidence_request",
  "hiring_request",
  "incident_escalation",
  "operator_approval_request",
] as const;
export type BusKind = (typeof BUS_KINDS)[number];

export const BUS_STATUSES = ["pending", "delivered", "replied", "expired", "dismissed"] as const;
export type BusStatus = (typeof BUS_STATUSES)[number];

export class AgentBusService {
  constructor(private readonly db: Db) {}

  async send(input: {
    companyId: string;
    fromAgentId?: string | null;
    toAgentId?: string | null;
    kind: BusKind;
    payload: Record<string, unknown>;
    parentMessageId?: string | null;
    expiresAt?: Date | null;
    /** Caller's autonomy level. The bus will rewrap into
     * operator_approval_request if this kind needs gating at this level. */
    senderAutonomyLevel?: number;
  }) {
    let kind: string = input.kind;
    let payload = input.payload;
    let rewrapReason: string | null = null;
    if (typeof input.senderAutonomyLevel === "number") {
      const level = input.senderAutonomyLevel;
      if (!canSendBusKindAtLevel(input.kind, level)) {
        // wrap into operator_approval_request
        kind = "operator_approval_request";
        rewrapReason = `autonomy L${level} insufficient for kind=${input.kind}`;
        payload = {
          originalKind: input.kind,
          originalPayload: input.payload,
          reason: rewrapReason,
        };
      } else if (requiresOperatorApproval(input.kind, level) && input.kind !== "operator_approval_request") {
        kind = "operator_approval_request";
        rewrapReason = `kind=${input.kind} requires operator approval at L${level}`;
        payload = {
          originalKind: input.kind,
          originalPayload: input.payload,
          reason: rewrapReason,
        };
      }
    }
    const [created] = await this.db
      .insert(agentBusMessages)
      .values({
        companyId: input.companyId,
        fromAgentId: input.fromAgentId ?? null,
        toAgentId: input.toAgentId ?? null,
        kind,
        payload,
        parentMessageId: input.parentMessageId ?? null,
        expiresAt: input.expiresAt ?? null,
        status: "pending",
      })
      .returning();
    // Sibling policy_check row when rewrap happened: surfaces the gating
    // event in the bus inspector independently of the wrapped message.
    // Direct insert (skip send() recursion) so this can never re-enter
    // gating itself.
    if (rewrapReason) {
      await this.db
        .insert(agentBusMessages)
        .values({
          companyId: input.companyId,
          fromAgentId: input.fromAgentId ?? null,
          toAgentId: null,
          kind: "policy_check",
          payload: {
            originalKind: input.kind,
            reason: rewrapReason,
            wrappedMessageId: created.id,
          },
          parentMessageId: created.id,
          status: "pending",
        });
    }
    return created;
  }

  async listForAgent(toAgentId: string, opts?: { status?: BusStatus; limit?: number }) {
    const conditions = [eq(agentBusMessages.toAgentId, toAgentId)];
    if (opts?.status) conditions.push(eq(agentBusMessages.status, opts.status));
    return this.db
      .select()
      .from(agentBusMessages)
      .where(and(...conditions))
      .orderBy(desc(agentBusMessages.createdAt))
      .limit(opts?.limit ?? 100);
  }

  async listForCompany(companyId: string, opts?: { kind?: BusKind; status?: BusStatus; limit?: number }) {
    const conditions = [eq(agentBusMessages.companyId, companyId)];
    if (opts?.kind) conditions.push(eq(agentBusMessages.kind, opts.kind));
    if (opts?.status) conditions.push(eq(agentBusMessages.status, opts.status));
    return this.db
      .select()
      .from(agentBusMessages)
      .where(and(...conditions))
      .orderBy(desc(agentBusMessages.createdAt))
      .limit(opts?.limit ?? 200);
  }

  async markStatus(messageId: string, status: BusStatus) {
    const patch: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === "delivered") patch.deliveredAt = new Date();
    if (status === "replied") patch.repliedAt = new Date();
    const [updated] = await this.db
      .update(agentBusMessages)
      .set(patch)
      .where(eq(agentBusMessages.id, messageId))
      .returning();
    return updated;
  }
}

export function agentBusService(db: Db) {
  return new AgentBusService(db);
}
