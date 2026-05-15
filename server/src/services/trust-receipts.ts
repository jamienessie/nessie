import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { trustReceipts } from "@nessie/db";

// Phase 7. Trust Receipts assemble the final "what shipped + who
// approved + what it cost + what evidence backs it" record per
// completed scope. Scopes mirror the black-box pattern (issue / hire /
// meeting / incident / release).

export type TrustReceiptScopeKind = "issue" | "hire" | "meeting" | "incident" | "release" | string;

export interface IssueTrustReceiptInput {
  scopeKind: TrustReceiptScopeKind;
  scopeId: string;
  summary: string;
  body?: Record<string, unknown>;
  issuedByAgentId?: string | null;
  issuedByUserId?: string | null;
}

export class TrustReceiptsService {
  constructor(private readonly db: Db) {}

  async listForScope(scopeKind: TrustReceiptScopeKind, scopeId: string, limit = 100) {
    return this.db
      .select()
      .from(trustReceipts)
      .where(and(eq(trustReceipts.scopeKind, scopeKind), eq(trustReceipts.scopeId, scopeId)))
      .orderBy(desc(trustReceipts.issuedAt))
      .limit(limit);
  }

  async issue(input: IssueTrustReceiptInput) {
    const [created] = await this.db
      .insert(trustReceipts)
      .values({
        scopeKind: input.scopeKind,
        scopeId: input.scopeId,
        summary: input.summary,
        body: input.body ?? {},
        issuedByAgentId: input.issuedByAgentId ?? null,
        issuedByUserId: input.issuedByUserId ?? null,
      })
      .returning();
    return created;
  }
}

export function trustReceiptsService(db: Db): TrustReceiptsService {
  return new TrustReceiptsService(db);
}
