import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScrollText } from "lucide-react";
import { trustReceiptsApi, type TrustReceiptScopeKind } from "../api/trustReceipts";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { Button } from "@/components/ui/button";
import { StackPanel, StackChip } from "@/components/stack";

const SCOPE_KINDS: TrustReceiptScopeKind[] = ["issue", "hire", "meeting", "incident", "release"];
const ACCENT = "#27D17F";

export default function TrustReceipts() {
  const { setBreadcrumbs } = useBreadcrumbs();
  const [scopeKind, setScopeKind] = useState<TrustReceiptScopeKind>("issue");
  const [scopeId, setScopeId] = useState("");
  const [submitted, setSubmitted] = useState<{ scopeKind: TrustReceiptScopeKind; scopeId: string } | null>(null);

  useEffect(() => {
    setBreadcrumbs([{ label: "Trust Receipts" }]);
  }, [setBreadcrumbs]);

  const receiptsQuery = useQuery({
    queryKey: ["trust-receipts", submitted?.scopeKind, submitted?.scopeId],
    queryFn: () => {
      if (!submitted) return Promise.resolve({ receipts: [] });
      return trustReceiptsApi.listForScope(submitted.scopeKind, submitted.scopeId);
    },
    enabled: Boolean(submitted),
  });

  const receipts = receiptsQuery.data?.receipts ?? [];

  return (
    <div className="flex flex-col gap-4 p-4">
      <StackPanel
        title={
          <span className="flex items-center gap-2">
            <ScrollText className="h-4 w-4" />
            Trust Receipts
          </span>
        }
        color={ACCENT}
      >
        <form
          className="flex flex-wrap items-end gap-3 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            const trimmed = scopeId.trim();
            if (trimmed) setSubmitted({ scopeKind, scopeId: trimmed });
          }}
        >
          <label className="flex flex-col gap-1 text-xs font-mono uppercase tracking-wider text-muted-foreground">
            scope
            <select
              value={scopeKind}
              onChange={(e) => setScopeKind(e.target.value as TrustReceiptScopeKind)}
              className="rounded-md border bg-background px-2 py-1 text-xs"
            >
              {SCOPE_KINDS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-1 flex-col gap-1 text-xs font-mono uppercase tracking-wider text-muted-foreground">
            scope id
            <input
              value={scopeId}
              onChange={(e) => setScopeId(e.target.value)}
              placeholder="uuid"
              className="rounded-md border bg-background px-2 py-1 text-xs font-mono"
            />
          </label>
          <Button type="submit" disabled={!scopeId.trim()}>List</Button>
        </form>
      </StackPanel>

      {!submitted ? (
        <EmptyState icon={ScrollText} message="Pick a scope kind and paste an id to load receipts." />
      ) : receiptsQuery.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading receipts…</p>
      ) : receipts.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          message={`No trust receipts for ${submitted.scopeKind}/${submitted.scopeId}.`}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {receipts.map((r) => (
            <li key={r.id}>
              <StackPanel
                color={ACCENT}
                title={
                  <span className="flex items-center gap-2 text-xs">
                    <StackChip>{r.scopeKind}</StackChip>
                    <span className="font-medium">{r.summary}</span>
                  </span>
                }
              >
                <div className="flex flex-col gap-2 p-3">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-mono">
                    issued {new Date(r.issuedAt).toLocaleString()}
                  </p>
                  <pre className="whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-[11px] font-mono">
                    {JSON.stringify(r.body, null, 2)}
                  </pre>
                </div>
              </StackPanel>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
