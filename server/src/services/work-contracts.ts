import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { workContracts } from "@nessie/db";

// Work Contracts service. Plan Principle 13. One contract per issue.

export const CONTRACT_STATES = ["draft", "active", "satisfied", "escalated", "cancelled"] as const;
export type ContractState = (typeof CONTRACT_STATES)[number];

const ALLOWED: Record<ContractState, ReadonlySet<ContractState>> = {
  draft: new Set(["active", "cancelled"]),
  active: new Set(["satisfied", "escalated", "cancelled"]),
  satisfied: new Set(),
  escalated: new Set(["active", "cancelled"]),
  cancelled: new Set(),
};

export function canContractTransition(from: ContractState, to: ContractState): boolean {
  return ALLOWED[from].has(to);
}

export class WorkContractsService {
  constructor(private readonly db: Db) {}

  async getByIssue(issueId: string) {
    const rows = await this.db
      .select()
      .from(workContracts)
      .where(eq(workContracts.issueId, issueId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listByOwner(ownerAgentId: string, opts?: { state?: ContractState }) {
    const conditions = [eq(workContracts.ownerAgentId, ownerAgentId)];
    if (opts?.state) conditions.push(eq(workContracts.state, opts.state));
    return this.db
      .select()
      .from(workContracts)
      .where(and(...conditions))
      .orderBy(desc(workContracts.updatedAt));
  }

  async upsert(input: {
    issueId: string;
    ownerAgentId?: string | null;
    reviewerAgentId?: string | null;
    acceptanceCriteria?: Array<{ criterion: string; weight?: number; evidenceRequired?: string[]; met?: boolean }>;
    evidence?: Array<{ kind: string; ref: string; summary?: string; addedAt?: string }>;
    toolBoundaries?: { allowed?: string[]; forbidden?: string[]; requireApproval?: string[] };
    budgetCents?: number;
    deadlineAt?: Date | null;
    escalationPolicy?: { onTimeout?: string; onBudgetBreach?: string; onSecurityAlert?: string };
  }) {
    const existing = await this.getByIssue(input.issueId);
    if (existing) {
      const [updated] = await this.db
        .update(workContracts)
        .set({
          ownerAgentId: input.ownerAgentId ?? existing.ownerAgentId,
          reviewerAgentId: input.reviewerAgentId ?? existing.reviewerAgentId,
          acceptanceCriteria: input.acceptanceCriteria ?? existing.acceptanceCriteria,
          evidence: input.evidence ?? existing.evidence,
          toolBoundaries: input.toolBoundaries ?? existing.toolBoundaries,
          budgetCents: input.budgetCents ?? existing.budgetCents,
          deadlineAt: input.deadlineAt ?? existing.deadlineAt,
          escalationPolicy: input.escalationPolicy ?? existing.escalationPolicy,
          updatedAt: new Date(),
        })
        .where(eq(workContracts.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await this.db
      .insert(workContracts)
      .values({
        issueId: input.issueId,
        ownerAgentId: input.ownerAgentId ?? null,
        reviewerAgentId: input.reviewerAgentId ?? null,
        acceptanceCriteria: input.acceptanceCriteria ?? [],
        evidence: input.evidence ?? [],
        toolBoundaries: input.toolBoundaries ?? {},
        budgetCents: input.budgetCents ?? 0,
        deadlineAt: input.deadlineAt ?? null,
        escalationPolicy: input.escalationPolicy ?? {},
        state: "draft",
      })
      .returning();
    return created;
  }

  async transition(contractId: string, to: ContractState) {
    const rows = await this.db.select().from(workContracts).where(eq(workContracts.id, contractId)).limit(1);
    const existing = rows[0];
    if (!existing) throw new Error(`Contract ${contractId} not found`);
    const from = existing.state as ContractState;
    if (!canContractTransition(from, to)) {
      throw new Error(`Illegal contract transition: ${from} -> ${to}`);
    }
    const now = new Date();
    const patch: Record<string, unknown> = { state: to, updatedAt: now };
    if (to === "active" && !existing.activatedAt) patch.activatedAt = now;
    if (to === "satisfied" || to === "cancelled") patch.closedAt = now;
    const [updated] = await this.db
      .update(workContracts)
      .set(patch)
      .where(eq(workContracts.id, contractId))
      .returning();
    return updated;
  }

  async addEvidence(contractId: string, item: { kind: string; ref: string; summary?: string }) {
    const [updated] = await this.db
      .update(workContracts)
      .set({
        evidence: sql`${workContracts.evidence} || ${JSON.stringify([{ ...item, addedAt: new Date().toISOString() }])}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(workContracts.id, contractId))
      .returning();
    return updated;
  }
}

export function workContractsService(db: Db) {
  return new WorkContractsService(db);
}
