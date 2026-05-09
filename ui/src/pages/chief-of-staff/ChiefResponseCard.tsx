import { Sparkles } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EntityRow } from "@/components/EntityRow";
import { Identity } from "@/components/Identity";
import { StatusIcon } from "@/components/StatusIcon";
import { PriorityIcon } from "@/components/PriorityIcon";
import { StatusBadge } from "@/components/StatusBadge";
import { Link } from "@/lib/router";
import { cn, formatCents } from "@/lib/utils";
import type { ChiefResponse, ChiefSection } from "@/api/chiefOfStaff";

interface ChiefResponseCardProps {
  response: ChiefResponse;
}

export function ChiefResponseCard({ response }: ChiefResponseCardProps) {
  return (
    <Card className="gap-3 py-4 border-0 shadow-none bg-transparent">
      <SummaryBlock summary={response.summary} intent={response.intent} />
      {response.sections.length === 0 ? null : (
        <div className="space-y-3">
          {response.sections.map((section, i) => (
            <SectionBlock key={`${section.heading}-${i}`} section={section} />
          ))}
        </div>
      )}
    </Card>
  );
}

function SummaryBlock({ summary, intent }: { summary: string; intent: string }) {
  return (
    <Card
      className="border py-3 gap-2"
      style={{
        backgroundColor: "var(--tone-operator-soft)",
        borderColor: "var(--tone-operator-fg)",
      }}
    >
      <CardContent className="flex items-start gap-3 px-4 py-0">
        <Sparkles
          className="size-4 mt-0.5 shrink-0"
          style={{ color: "var(--tone-operator-fg)" }}
        />
        <div className="min-w-0 space-y-1">
          <span
            className="text-[10px] font-mono uppercase tracking-wider"
            style={{ color: "var(--tone-operator-fg)" }}
          >
            {intent.replace(/_/g, " ")}
          </span>
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{summary}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function SectionBlock({ section }: { section: ChiefSection }) {
  return (
    <Card className="py-0 gap-0 overflow-hidden">
      <header className="flex items-center justify-between border-b border-border px-4 py-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {section.heading}
        </h4>
        <span className="text-[10px] tabular-nums text-muted-foreground font-mono">
          {section.rows.length} row{section.rows.length === 1 ? "" : "s"}
        </span>
      </header>
      {section.rows.length === 0 ? (
        <p className="text-xs text-muted-foreground italic px-4 py-3">Nothing here.</p>
      ) : (
        <SectionRenderer section={section} />
      )}
    </Card>
  );
}

function SectionRenderer({ section }: { section: ChiefSection }) {
  switch (section.kind) {
    case "agents":
      return <AgentsRenderer rows={section.rows} />;
    case "issues":
      return <IssuesRenderer rows={section.rows} />;
    case "meetings":
      return <MeetingsRenderer rows={section.rows} />;
    case "costs":
      return <CostsRenderer rows={section.rows} />;
    case "approvals":
      return <ApprovalsRenderer rows={section.rows} />;
    case "inbox":
      return <InboxRenderer rows={section.rows} />;
    case "hires":
      return <HiresRenderer rows={section.rows} />;
    case "generic":
    default:
      return <GenericTable rows={section.rows} />;
  }
}

// ─── intent renderers ──────────────────────────────────────────────────

function AgentsRenderer({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div>
      {rows.map((row, i) => {
        const id = pickString(row.id) ?? `row-${i}`;
        const name = pickString(row.name) ?? "Unknown";
        const title = pickString(row.title);
        const status = pickString(row.status);
        const reputationScore = pickNumber(row.reputationScore);
        const tier = pickString(row.tier);
        return (
          <EntityRow
            key={id}
            leading={<Identity name={name} agentId={id} size="sm" />}
            identifier={tier ?? (reputationScore != null ? `rep ${reputationScore}` : undefined)}
            title={title ? `${title}` : name}
            subtitle={title ? name : undefined}
            trailing={status ? <StatusBadge status={status} /> : undefined}
            to={`/agents/${id}`}
          />
        );
      })}
    </div>
  );
}

function IssuesRenderer({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div>
      {rows.map((row, i) => {
        const id = pickString(row.id) ?? `row-${i}`;
        const identifier = pickString(row.identifier);
        const title = pickString(row.title) ?? "(untitled)";
        const status = pickString(row.status) ?? "todo";
        const priority = pickString(row.priority);
        const link = identifier ? `/issues/${identifier}` : `/issues/${id}`;
        return (
          <EntityRow
            key={id}
            leading={
              <>
                <StatusIcon status={status} />
                {priority && <PriorityIcon priority={priority} />}
              </>
            }
            identifier={identifier ?? undefined}
            title={title}
            to={link}
          />
        );
      })}
    </div>
  );
}

function MeetingsRenderer({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div>
      {rows.map((row, i) => {
        const id = pickString(row.id) ?? `row-${i}`;
        const title = pickString(row.title) ?? "(untitled meeting)";
        const state = pickString(row.state) ?? "active";
        return (
          <EntityRow
            key={id}
            leading={<StatusBadge status={state} />}
            title={title}
            trailing={
              <Button asChild size="sm" variant="outline">
                <Link to={`/meetings/${id}/room`}>Enter →</Link>
              </Button>
            }
          />
        );
      })}
    </div>
  );
}

function CostsRenderer({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-accent/20 text-muted-foreground">
          <tr>
            <th className="px-4 py-2 text-left font-mono uppercase tracking-wider text-[10px]">Provider</th>
            <th className="px-4 py-2 text-left font-mono uppercase tracking-wider text-[10px]">Billing</th>
            <th className="px-4 py-2 text-right font-mono uppercase tracking-wider text-[10px]">Spend (7d)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const provider = pickString(row.provider) ?? "—";
            const billing = pickString(row.billingType) ?? "—";
            const cents = pickNumber(row.cents) ?? 0;
            return (
              <tr key={i} className="border-b border-border last:border-b-0 hover:bg-accent/30">
                <td className="px-4 py-2 font-medium">{provider}</td>
                <td className="px-4 py-2 text-muted-foreground">{billing}</td>
                <td className="px-4 py-2 text-right font-mono tabular-nums">
                  {formatCents(cents)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ApprovalsRenderer({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div>
      {rows.map((row, i) => {
        const id = pickString(row.id) ?? `row-${i}`;
        const kind = pickString(row.kind) ?? "approval";
        const meetingId = pickString(row.meetingId);
        const title = describeApproval(row);
        const link = meetingId ? `/meetings/${meetingId}/room` : `/inbox/requests`;
        return (
          <EntityRow
            key={id}
            leading={<Badge variant="outline" className="font-mono uppercase text-[10px]">{kind}</Badge>}
            title={title}
            to={link}
          />
        );
      })}
    </div>
  );
}

function describeApproval(row: Record<string, unknown>): string {
  const payload = row.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const p = payload as Record<string, unknown>;
    const summary = pickString(p.summary) ?? pickString(p.reason) ?? pickString(p.title);
    if (summary) return summary;
  }
  return pickString(row.kind) ?? "Awaiting your decision";
}

function InboxRenderer({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div>
      {rows.map((row, i) => {
        const id = pickString(row.id) ?? `row-${i}`;
        const kind = pickString(row.kind) ?? "note";
        const body = pickString(row.bodyMarkdown) ?? "(no body)";
        const preview = body.length > 120 ? `${body.slice(0, 120)}…` : body;
        return (
          <EntityRow
            key={id}
            leading={<Badge variant="outline" className="font-mono uppercase text-[10px]">{kind}</Badge>}
            title={preview}
            to="/inbox/recent"
          />
        );
      })}
    </div>
  );
}

function HiresRenderer({ rows }: { rows: Array<Record<string, unknown>> }) {
  return (
    <div>
      {rows.map((row, i) => {
        const id = pickString(row.id) ?? `row-${i}`;
        const title = pickString(row.title) ?? "(untitled hire)";
        const status = pickString(row.status);
        return (
          <EntityRow
            key={id}
            title={title}
            trailing={status ? <StatusBadge status={status} /> : undefined}
            to="/hiring"
          />
        );
      })}
    </div>
  );
}

function GenericTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) continue;
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) {
        seen.add(k);
        keys.push(k);
      }
    }
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-accent/20 text-muted-foreground">
          <tr>
            {keys.map((k) => (
              <th
                key={k}
                className="px-4 py-2 text-left font-mono uppercase tracking-wider text-[10px]"
              >
                {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-border last:border-b-0 hover:bg-accent/30">
              {keys.map((k) => (
                <td key={k} className={cn("px-4 py-2 align-top font-mono text-[11px]")}>
                  {renderCellValue(row[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── value helpers ─────────────────────────────────────────────────────

function pickString(value: unknown): string | null {
  if (typeof value === "string" && value.trim().length > 0) return value;
  if (typeof value === "number") return String(value);
  return null;
}

function pickNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !isNaN(Number(value))) return Number(value);
  return null;
}

function renderCellValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toLocaleString();
  return JSON.stringify(value);
}
