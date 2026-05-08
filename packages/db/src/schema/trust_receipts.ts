import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";

// Plan §20.24 Trust Receipts.
//
// For any completed scope (issue, hire, meeting, incident, release), a
// trust receipt assembles "what shipped", "who approved it", "what it
// cost", "what policies governed it", "what evidence backs the claims",
// "which agents contributed", and "what limitations apply".
//
// Trust Receipts close the loop on Phase 6: they pull together the
// evidence/work_contracts data, the operator-approved meeting outcomes,
// the cost_events trail, the reviewer's approval, and a one-line
// limitation summary into a single readable artifact.
//
// scope_kind / scope_id mirror the black_box pattern. summary is the
// short readable header. The body is structured jsonb the Cockpit
// renders inline.

export const trustReceipts = pgTable(
  "trust_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scopeKind: text("scope_kind").notNull(), // issue | hire | meeting | incident | release
    scopeId: uuid("scope_id").notNull(),
    summary: text("summary").notNull(),
    /** body shape:
     *   {
     *     evidence: Array<{kind, ref, summary?}>,
     *     policiesApplied: string[],
     *     costCents: number,
     *     costBreakdown?: Array<{tier, cents}>,
     *     contributors: Array<{agentId, displayName, title, role}>,
     *     reviewers: Array<{agentId, displayName, title}>,
     *     approvedAt?: string,
     *     limitations?: string[],
     *     workContractId?: string,
     *     blackBoxRecordIds?: string[]
     *   }
     */
    body: jsonb("body").$type<Record<string, unknown>>().notNull().default({}),
    issuedByAgentId: uuid("issued_by_agent_id"),
    issuedByUserId: text("issued_by_user_id"),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    scopeIdx: index("trust_receipts_scope_idx").on(table.scopeKind, table.scopeId),
    scopeIssuedIdx: index("trust_receipts_scope_issued_idx").on(table.scopeKind, table.scopeId, table.issuedAt),
  }),
);
