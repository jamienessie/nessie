import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { inboxItems } from "@nessie/db";

// Phase 7 universal-capture inbox. Distinct from the Cockpit /inbox
// work-list page (which lists issues + approvals); this is the
// "everything else" bucket the operator dumps notes / urls / files into
// and triages later.

export type InboxKind = "note" | "url" | "file" | "voice" | string;
export type InboxStatus = "captured" | "dismissed" | "saved_as_memory" | "became_issue" | string;

export interface CreateInboxItemInput {
  companyId: string;
  kind?: InboxKind;
  bodyMarkdown?: string | null;
  refs?: unknown[];
  capturedByUserId?: string | null;
}

export interface TriageInboxItemInput {
  status: InboxStatus;
  notes?: string | null;
  promotedKind?: string | null;
  promotedId?: string | null;
}

export class InboxItemsService {
  constructor(private readonly db: Db) {}

  async list(companyId: string, opts?: { status?: InboxStatus; limit?: number }) {
    const conditions = [eq(inboxItems.companyId, companyId)];
    if (opts?.status) conditions.push(eq(inboxItems.status, opts.status));
    return this.db
      .select()
      .from(inboxItems)
      .where(and(...conditions))
      .orderBy(desc(inboxItems.createdAt))
      .limit(opts?.limit ?? 200);
  }

  async create(input: CreateInboxItemInput) {
    const [created] = await this.db
      .insert(inboxItems)
      .values({
        companyId: input.companyId,
        kind: input.kind ?? "note",
        bodyMarkdown: input.bodyMarkdown ?? null,
        refs: (input.refs ?? []) as never,
        status: "captured",
        capturedByUserId: input.capturedByUserId ?? null,
      })
      .returning();
    return created;
  }

  async triage(itemId: string, input: TriageInboxItemInput) {
    const [updated] = await this.db
      .update(inboxItems)
      .set({
        status: input.status,
        triagedAt: new Date(),
        triagedNotes: input.notes ?? null,
        promotedKind: input.promotedKind ?? null,
        promotedId: input.promotedId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(inboxItems.id, itemId))
      .returning();
    return updated ?? null;
  }
}

export function inboxItemsService(db: Db): InboxItemsService {
  return new InboxItemsService(db);
}
