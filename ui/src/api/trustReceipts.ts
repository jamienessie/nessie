import { api } from "./client";

// Phase 7 trust receipts. Backend at server/src/routes/trust-receipts.ts.

export type TrustReceiptScopeKind = "issue" | "hire" | "meeting" | "incident" | "release" | string;

export interface TrustReceipt {
  id: string;
  scopeKind: TrustReceiptScopeKind;
  scopeId: string;
  summary: string;
  body: Record<string, unknown>;
  issuedByAgentId: string | null;
  issuedByUserId: string | null;
  issuedAt: string;
  createdAt: string;
}

export const trustReceiptsApi = {
  listForScope: (scopeKind: TrustReceiptScopeKind, scopeId: string) =>
    api.get<{ receipts: TrustReceipt[] }>(
      `/trust-receipts?scopeKind=${encodeURIComponent(scopeKind)}&scopeId=${encodeURIComponent(scopeId)}`,
    ),
};
