import { and, desc, eq, sum } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { agents, reputationEvents } from "@nessie/db";

// Reputation. Plan §19. Aggregate over reputation_events per agent,
// clamped 0..100. Recomputed on every recordEvent so agents.
// reputation_score stays the source of truth for cards / cockpit.

export const REPUTATION_DIMENSIONS = [
  "quality",
  "speed",
  "cost_efficiency",
  "reliability",
  "review_pass_rate",
  "collaboration",
  "meeting_usefulness",
  "evidence_quality",
  "policy_compliance",
  "operator_trust",
] as const;
export type ReputationDimension = (typeof REPUTATION_DIMENSIONS)[number];

const BASELINE = 50;
const MIN = 0;
const MAX = 100;

export class ReputationService {
  constructor(private readonly db: Db) {}

  async recordEvent(input: {
    agentId: string;
    dimension: ReputationDimension;
    delta: number;
    reason: string;
    evidenceRef?: string | null;
    metadata?: Record<string, unknown>;
  }) {
    const [created] = await this.db
      .insert(reputationEvents)
      .values({
        agentId: input.agentId,
        dimension: input.dimension,
        delta: input.delta,
        reason: input.reason,
        evidenceRef: input.evidenceRef ?? null,
        metadata: input.metadata ?? null,
      })
      .returning();
    await this.recompute(input.agentId);
    return created;
  }

  async recompute(agentId: string): Promise<number> {
    const sumRow = await this.db
      .select({ total: sum(reputationEvents.delta) })
      .from(reputationEvents)
      .where(eq(reputationEvents.agentId, agentId));
    const totalRaw = sumRow[0]?.total ?? 0;
    const total = typeof totalRaw === "string" ? Number(totalRaw) : Number(totalRaw ?? 0);
    const score = Math.max(MIN, Math.min(MAX, BASELINE + total));
    await this.db.update(agents).set({ reputationScore: score, updatedAt: new Date() }).where(eq(agents.id, agentId));
    return score;
  }

  async listEvents(agentId: string, opts?: { dimension?: ReputationDimension; limit?: number }) {
    const conditions = [eq(reputationEvents.agentId, agentId)];
    if (opts?.dimension) conditions.push(eq(reputationEvents.dimension, opts.dimension));
    return this.db
      .select()
      .from(reputationEvents)
      .where(and(...conditions))
      .orderBy(desc(reputationEvents.occurredAt))
      .limit(opts?.limit ?? 100);
  }
}

export function reputationService(db: Db) {
  return new ReputationService(db);
}
