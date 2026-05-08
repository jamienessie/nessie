import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@nessie/db";
import {
  agentBusMessages,
  costEvents,
  hires,
  inboxItems,
  issues,
  meetingOutcomes,
  meetings,
  reputationEvents,
} from "@nessie/db";

// Executive Briefs — plan §20.12.
//
// Daily / weekly / monthly summaries. Read-only across Phase 0–7
// tables. compose() returns the structured Brief; the route layer
// can render or commit it. No new schema; the persistence path
// (writing to `documents`) is intentionally optional in v1 so the
// brief is also useful as a one-shot "tell me what happened" call
// without DB writes.

export type BriefPeriod = "daily" | "weekly" | "monthly";

export interface BriefSection {
  heading: string;
  rows: Array<Record<string, unknown>>;
}

export interface ExecutiveBrief {
  period: BriefPeriod;
  range: { fromIso: string; toIso: string };
  costSummary: { T1: number; T2: number; T3: number; total: number };
  sections: BriefSection[];
  citations: string[];
}

function rangeFor(period: BriefPeriod, now: Date = new Date()): { from: Date; to: Date } {
  const to = now;
  const from = new Date(to);
  if (period === "daily") from.setDate(from.getDate() - 1);
  else if (period === "weekly") from.setDate(from.getDate() - 7);
  else from.setDate(from.getDate() - 30);
  return { from, to };
}

export class ExecutiveBriefsService {
  constructor(private readonly db: Db) {}

  async compose(period: BriefPeriod, companyId: string): Promise<ExecutiveBrief> {
    const { from, to } = rangeFor(period);
    const fromIso = from.toISOString();
    const toIso = to.toISOString();

    // Cost rollup by tier (using the billingCode set by the proxy: "tier:T1" etc).
    const tierCosts = await this.db
      .select({
        billingCode: costEvents.billingCode,
        cents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
      })
      .from(costEvents)
      .where(and(eq(costEvents.companyId, companyId), gte(costEvents.occurredAt, from)))
      .groupBy(costEvents.billingCode);
    const costSummary = { T1: 0, T2: 0, T3: 0, total: 0 };
    for (const row of tierCosts) {
      const cents = row.cents ?? 0;
      costSummary.total += cents;
      const code = row.billingCode ?? "";
      if (code.endsWith("T1")) costSummary.T1 += cents;
      else if (code.endsWith("T2")) costSummary.T2 += cents;
      else if (code.endsWith("T3")) costSummary.T3 += cents;
    }

    // What changed: completed issues + closed work contracts.
    const completedIssues = await this.db.select({ id: issues.id, title: issues.title, completedAt: issues.completedAt })
      .from(issues).where(and(eq(issues.companyId, companyId), gte(issues.completedAt, from))).limit(50);

    // What broke: failed meetings + incident bus messages.
    const failedMeetings = await this.db.select({ id: meetings.id, title: meetings.title, state: meetings.state })
      .from(meetings).where(and(eq(meetings.companyId, companyId), eq(meetings.state, "failed"), gte(meetings.updatedAt, from))).limit(20);
    const incidents = await this.db.select({ id: agentBusMessages.id, payload: agentBusMessages.payload, createdAt: agentBusMessages.createdAt })
      .from(agentBusMessages).where(and(
        eq(agentBusMessages.companyId, companyId),
        eq(agentBusMessages.kind, "incident_escalation"),
        gte(agentBusMessages.createdAt, from),
      )).limit(20);

    // What got expensive: top 5 cost rows by cents.
    const expensive = await this.db.select({
      provider: costEvents.provider, model: costEvents.model, biller: costEvents.biller,
      cents: costEvents.costCents, occurredAt: costEvents.occurredAt,
    }).from(costEvents).where(and(eq(costEvents.companyId, companyId), gte(costEvents.occurredAt, from)))
      .orderBy(desc(costEvents.costCents)).limit(5);

    // Needs approval: pending operator_approval_request + recommended hires + unapproved outcomes.
    const approvalReqs = await this.db.select({ id: agentBusMessages.id, payload: agentBusMessages.payload })
      .from(agentBusMessages).where(and(
        eq(agentBusMessages.companyId, companyId),
        eq(agentBusMessages.kind, "operator_approval_request"),
        eq(agentBusMessages.status, "pending"),
      )).limit(20);
    const recommendedHires = await this.db.select({ id: hires.id, title: hires.title })
      .from(hires).where(and(eq(hires.companyId, companyId), eq(hires.status, "recommended"))).limit(20);

    // Who struggled: agents with negative reputation deltas in window.
    const negDeltas = await this.db
      .select({
        agentId: reputationEvents.agentId,
        net: sql<number>`coalesce(sum(${reputationEvents.delta}), 0)::int`,
        count: count(reputationEvents.id),
      })
      .from(reputationEvents)
      .where(gte(reputationEvents.occurredAt, from))
      .groupBy(reputationEvents.agentId);
    const struggled = negDeltas.filter((row) => (row.net ?? 0) < 0);

    // Decisions: approved meeting outcomes in window.
    const decisions = await this.db.select({
      id: meetingOutcomes.id, kind: meetingOutcomes.kind, payload: meetingOutcomes.payload,
    }).from(meetingOutcomes)
      .where(and(eq(meetingOutcomes.approvedByOperator, true), gte(meetingOutcomes.approvedAt, from))).limit(50);

    // Next actions: untriaged inbox items.
    const untriaged = await this.db.select({ id: inboxItems.id, kind: inboxItems.kind, bodyMarkdown: inboxItems.bodyMarkdown })
      .from(inboxItems).where(and(eq(inboxItems.companyId, companyId), eq(inboxItems.status, "captured"))).limit(20);

    return {
      period,
      range: { fromIso, toIso },
      costSummary,
      sections: [
        { heading: "What shipped", rows: completedIssues },
        { heading: "What broke", rows: [...failedMeetings, ...incidents] },
        { heading: "What got expensive", rows: expensive },
        { heading: "Needs approval", rows: [...approvalReqs, ...recommendedHires] },
        { heading: "Who struggled (rep deltas in window)", rows: struggled },
        { heading: "Decisions", rows: decisions },
        { heading: "Next actions (untriaged inbox)", rows: untriaged },
      ],
      citations: [
        `cost_events between ${fromIso} and ${toIso}`,
        `meetings/meeting_outcomes window`,
        `agent_bus_messages incident + approval window`,
        `inbox_items status=captured`,
        `reputation_events window`,
      ],
    };
  }
}

export function executiveBriefsService(db: Db): ExecutiveBriefsService {
  return new ExecutiveBriefsService(db);
}
