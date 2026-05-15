import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound } from "lucide-react";
import { credentialsApi, type CredentialView } from "../api/credentials";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { EmptyState } from "../components/EmptyState";
import { StackPanel, StackChip } from "@/components/stack";
import { formatCents } from "../lib/utils";

const ACCENT = "#FFA94D";

function tierAccent(tier: string): string {
  if (tier === "T1") return "#FFE6B5";
  if (tier === "T2") return "#DDD2FF";
  return "#C5F0FF";
}

function statusAccent(status: string, healthStatus: string | null): string {
  if (status === "exhausted") return "#FF4F4F";
  if (status === "auth_failed") return "#FF4F4F";
  if (status === "paused" || status === "disabled") return "#cbd5e1";
  if (healthStatus === "rate_limited") return "#FFB400";
  if (healthStatus === "degraded") return "#FFB400";
  return "#27D17F";
}

function quotaPct(c: CredentialView): number | null {
  if (c.dailyRequestCap == null || c.dailyRequestCap <= 0) return null;
  const reset = c.dailyResetAt ? new Date(c.dailyResetAt).getTime() : null;
  const effective = reset && reset <= Date.now() ? 0 : c.dailyRequestCount;
  return Math.min(1, effective / c.dailyRequestCap);
}

function quotaLabel(c: CredentialView): string {
  if (c.dailyRequestCap == null) return "no daily cap";
  const reset = c.dailyResetAt ? new Date(c.dailyResetAt).getTime() : null;
  const effective = reset && reset <= Date.now() ? 0 : c.dailyRequestCount;
  return `${effective} / ${c.dailyRequestCap} today`;
}

export default function Credentials() {
  const { setBreadcrumbs } = useBreadcrumbs();
  useEffect(() => {
    setBreadcrumbs([{ label: "Credentials" }]);
  }, [setBreadcrumbs]);

  const q = useQuery({
    queryKey: ["credentials"],
    queryFn: () => credentialsApi.list(),
  });

  const rows: CredentialView[] = q.data?.credentials ?? [];
  const byTier = new Map<string, CredentialView[]>();
  for (const r of rows) {
    const arr = byTier.get(r.tier) ?? [];
    arr.push(r);
    byTier.set(r.tier, arr);
  }
  const tierOrder = ["T1", "T2", "T3"];

  return (
    <div className="flex flex-col gap-4 p-4">
      <StackPanel
        color={ACCENT}
        title={
          <span className="flex items-center gap-2">
            <KeyRound className="h-4 w-4" />
            Credentials · Quota Watchdog
          </span>
        }
      >
        <div className="p-3 text-xs text-muted-foreground">
          Daily request quotas update as the proxy forwards calls. A
          credential at-or-above its cap is excluded from the picker
          until midnight UTC. On a 429, the proxy marks the credential
          exhausted and rotates to a sibling (up to 3 attempts before
          tier_rate_limited).
        </div>
      </StackPanel>

      {q.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={KeyRound} message="No credentials configured." />
      ) : (
        tierOrder.map((tier) => {
          const list = byTier.get(tier);
          if (!list || list.length === 0) return null;
          return (
            <StackPanel
              key={tier}
              color={tierAccent(tier)}
              title={
                <span className="flex items-center gap-2">
                  {tier}
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {list.length} credential{list.length === 1 ? "" : "s"}
                  </span>
                </span>
              }
            >
              <ul className="flex flex-col gap-1 p-2">
                {list.map((c) => {
                  const pct = quotaPct(c);
                  return (
                    <li
                      key={c.id}
                      className="grid grid-cols-1 gap-2 rounded-md border bg-background p-3 text-xs md:grid-cols-[1fr_auto_auto_auto]"
                    >
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span className="font-mono">{c.displayName}</span>
                          <StackChip color={statusAccent(c.status, c.lastHealthStatus)}>
                            {c.status}
                          </StackChip>
                          {c.lastHealthStatus && c.lastHealthStatus !== "healthy" && (
                            <StackChip color={statusAccent(c.status, c.lastHealthStatus)}>
                              {c.lastHealthStatus}
                            </StackChip>
                          )}
                        </div>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {c.provider}
                        </span>
                      </div>
                      <div className="flex flex-col gap-1 text-[11px]">
                        <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                          daily quota
                        </span>
                        <span>{quotaLabel(c)}</span>
                      </div>
                      <div className="flex flex-col gap-1 text-[11px]">
                        <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                          monthly spend
                        </span>
                        <span>
                          {formatCents(c.monthlySpentCents)}
                          {c.monthlyCapCents != null && (
                            <span className="text-muted-foreground">
                              {" "}
                              / {formatCents(c.monthlyCapCents)}
                            </span>
                          )}
                        </span>
                      </div>
                      {pct != null && (
                        <div className="flex flex-col gap-1 text-[11px]">
                          <span className="font-mono uppercase tracking-wider text-[10px] text-muted-foreground">
                            usage
                          </span>
                          <div className="h-2 w-32 overflow-hidden rounded-full bg-muted">
                            <div
                              style={{
                                width: `${pct * 100}%`,
                                background: pct >= 0.9 ? "#FF4F4F" : pct >= 0.7 ? "#FFB400" : "#27D17F",
                                height: "100%",
                              }}
                            />
                          </div>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </StackPanel>
          );
        })
      )}
    </div>
  );
}
