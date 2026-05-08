import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "@nessie/db";
import {
  agents,
  agentBusMessages,
  costEvents,
  hires,
  inboxItems,
  issues,
  meetings,
  meetingOutcomes,
  workContracts,
} from "@nessie/db";

// Chief of Staff — plan §20.2.
//
// Single conversational command surface. Reads state across Phase 0–7
// subsystems, returns a structured response the operator can scan or
// the Cockpit can render in a panel. No new schema, all read-only.
//
// The intent classifier is a small string-match table, not an LLM call.
// That's deliberate for v1 — predictable, free, debuggable. A real
// model can swap in by replacing classifyIntent() without touching the
// dispatch table.

export type ChiefSection = {
  heading: string;
  rows: Array<Record<string, unknown>>;
};
export type ChiefResponse = {
  intent: string;
  summary: string;
  sections: ChiefSection[];
};

const INTENT_KEYWORDS: Array<{ intent: string; needles: string[] }> = [
  { intent: "what_is_happening", needles: ["happening", "going on", "what's up"] },
  { intent: "what_is_blocked", needles: ["blocked", "stuck", "waiting on"] },
  { intent: "what_needs_approval", needles: ["approval", "approve", "needs sign", "sign-off"] },
  { intent: "what_is_wasting_money", needles: ["wasting", "money", "spend", "burn", "cost"] },
  { intent: "what_should_happen_next", needles: ["next", "should i", "priority", "should happen"] },
  { intent: "which_agents_are_struggling", needles: ["struggling", "underperforming", "rep", "reputation"] },
];

export function classifyIntent(command: string): string {
  const lower = command.toLowerCase();
  for (const row of INTENT_KEYWORDS) {
    if (row.needles.some((n) => lower.includes(n))) return row.intent;
  }
  return "default";
}

export class ChiefOfStaffService {
  constructor(private readonly db: Db) {}

  async ask(command: string, ctx: { companyId: string }): Promise<ChiefResponse> {
    const intent = classifyIntent(command);
    switch (intent) {
      case "what_is_happening":
        return this.whatIsHappening(ctx);
      case "what_is_blocked":
        return this.whatIsBlocked(ctx);
      case "what_needs_approval":
        return this.whatNeedsApproval(ctx);
      case "what_is_wasting_money":
        return this.whatIsWastingMoney(ctx);
      case "what_should_happen_next":
        return this.whatShouldHappenNext(ctx);
      case "which_agents_are_struggling":
        return this.whichAgentsAreStruggling(ctx);
      default:
        return {
          intent: "default",
          summary: `I didn't recognise "${command}". Try: what's happening | what's blocked | what needs approval | what's wasting money | what should happen next | which agents are struggling.`,
          sections: [],
        };
    }
  }

  private async whatIsHappening(ctx: { companyId: string }): Promise<ChiefResponse> {
    const activeAgents = await this.db.select({ id: agents.id, name: agents.name, status: agents.status, title: agents.title })
      .from(agents).where(and(eq(agents.companyId, ctx.companyId), eq(agents.status, "running"))).limit(20);
    const pendingBus = await this.db.select({ id: agentBusMessages.id, kind: agentBusMessages.kind })
      .from(agentBusMessages).where(and(eq(agentBusMessages.companyId, ctx.companyId), eq(agentBusMessages.status, "pending"))).limit(20);
    const liveMeetings = await this.db.select({ id: meetings.id, title: meetings.title, state: meetings.state })
      .from(meetings).where(and(eq(meetings.companyId, ctx.companyId), eq(meetings.state, "active"))).limit(10);
    return {
      intent: "what_is_happening",
      summary: `${activeAgents.length} agent run${activeAgents.length === 1 ? "" : "s"}, ${pendingBus.length} pending bus message${pendingBus.length === 1 ? "" : "s"}, ${liveMeetings.length} live meeting${liveMeetings.length === 1 ? "" : "s"}.`,
      sections: [
        { heading: "Agents running", rows: activeAgents },
        { heading: "Pending bus messages", rows: pendingBus },
        { heading: "Live meetings", rows: liveMeetings },
      ],
    };
  }

  private async whatIsBlocked(ctx: { companyId: string }): Promise<ChiefResponse> {
    const blockedIssues = await this.db.select({ id: issues.id, title: issues.title, status: issues.status })
      .from(issues).where(and(eq(issues.companyId, ctx.companyId), eq(issues.status, "blocked"))).limit(50);
    const policyChecks = await this.db.select({ id: agentBusMessages.id, payload: agentBusMessages.payload })
      .from(agentBusMessages).where(and(
        eq(agentBusMessages.companyId, ctx.companyId),
        eq(agentBusMessages.kind, "policy_check"),
        eq(agentBusMessages.status, "pending"),
      )).limit(20);
    const meetingsWaiting = await this.db.select({ id: meetings.id, title: meetings.title })
      .from(meetings).where(and(eq(meetings.companyId, ctx.companyId), eq(meetings.state, "waiting_for_operator"))).limit(20);
    return {
      intent: "what_is_blocked",
      summary: `${blockedIssues.length} blocked issue${blockedIssues.length === 1 ? "" : "s"}, ${policyChecks.length} pending policy check${policyChecks.length === 1 ? "" : "s"}, ${meetingsWaiting.length} meeting${meetingsWaiting.length === 1 ? "" : "s"} awaiting you.`,
      sections: [
        { heading: "Blocked issues", rows: blockedIssues },
        { heading: "Pending policy checks", rows: policyChecks },
        { heading: "Meetings awaiting operator", rows: meetingsWaiting },
      ],
    };
  }

  private async whatNeedsApproval(ctx: { companyId: string }): Promise<ChiefResponse> {
    const approvalReqs = await this.db.select({ id: agentBusMessages.id, payload: agentBusMessages.payload, createdAt: agentBusMessages.createdAt })
      .from(agentBusMessages).where(and(
        eq(agentBusMessages.companyId, ctx.companyId),
        eq(agentBusMessages.kind, "operator_approval_request"),
        eq(agentBusMessages.status, "pending"),
      )).orderBy(desc(agentBusMessages.createdAt)).limit(50);
    const unapprovedOutcomes = await this.db.select({
      id: meetingOutcomes.id, kind: meetingOutcomes.kind, meetingId: meetingOutcomes.meetingId,
    }).from(meetingOutcomes).where(eq(meetingOutcomes.approvedByOperator, false)).limit(50);
    const recommendedHires = await this.db.select({ id: hires.id, title: hires.title })
      .from(hires).where(and(eq(hires.companyId, ctx.companyId), eq(hires.status, "recommended"))).limit(20);
    return {
      intent: "what_needs_approval",
      summary: `${approvalReqs.length} operator-approval request${approvalReqs.length === 1 ? "" : "s"}, ${unapprovedOutcomes.length} unapproved meeting outcome${unapprovedOutcomes.length === 1 ? "" : "s"}, ${recommendedHires.length} hire${recommendedHires.length === 1 ? "" : "s"} ready for you.`,
      sections: [
        { heading: "Approval requests on the bus", rows: approvalReqs },
        { heading: "Meeting outcomes pending", rows: unapprovedOutcomes },
        { heading: "Hires ready to mint", rows: recommendedHires },
      ],
    };
  }

  private async whatIsWastingMoney(ctx: { companyId: string }): Promise<ChiefResponse> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const totals = await this.db
      .select({
        provider: costEvents.provider,
        billingType: costEvents.billingType,
        cents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int`,
      })
      .from(costEvents)
      .where(and(eq(costEvents.companyId, ctx.companyId), gte(costEvents.occurredAt, sevenDaysAgo)))
      .groupBy(costEvents.provider, costEvents.billingType);
    let total = 0;
    for (const row of totals) total += row.cents ?? 0;
    return {
      intent: "what_is_wasting_money",
      summary: `Last 7 days: $${(total / 100).toFixed(2)} across ${totals.length} provider/billing pair${totals.length === 1 ? "" : "s"}.`,
      sections: [{ heading: "Spend by provider · billing type (7d)", rows: totals }],
    };
  }

  private async whatShouldHappenNext(ctx: { companyId: string }): Promise<ChiefResponse> {
    const untriaged = await this.db.select({ id: inboxItems.id, kind: inboxItems.kind, bodyMarkdown: inboxItems.bodyMarkdown })
      .from(inboxItems).where(and(eq(inboxItems.companyId, ctx.companyId), eq(inboxItems.status, "captured"))).limit(20);
    const dueContracts = await this.db.select({ id: workContracts.id, issueId: workContracts.issueId, deadlineAt: workContracts.deadlineAt })
      .from(workContracts).where(eq(workContracts.state, "active")).limit(20);
    return {
      intent: "what_should_happen_next",
      summary: `${untriaged.length} untriaged inbox item${untriaged.length === 1 ? "" : "s"}, ${dueContracts.length} active work contract${dueContracts.length === 1 ? "" : "s"}.`,
      sections: [
        { heading: "Inbox awaiting triage", rows: untriaged },
        { heading: "Active work contracts", rows: dueContracts },
      ],
    };
  }

  private async whichAgentsAreStruggling(ctx: { companyId: string }): Promise<ChiefResponse> {
    const lowReputationAgents = await this.db.select({
      id: agents.id, name: agents.name, title: agents.title, reputationScore: agents.reputationScore,
      tier: agents.tier, status: agents.status,
    }).from(agents).where(eq(agents.companyId, ctx.companyId)).orderBy(agents.reputationScore).limit(10);
    return {
      intent: "which_agents_are_struggling",
      summary: `Bottom ${lowReputationAgents.length} agent${lowReputationAgents.length === 1 ? "" : "s"} by reputation score.`,
      sections: [{ heading: "Lowest reputation first", rows: lowReputationAgents }],
    };
  }
}

export function chiefOfStaffService(db: Db): ChiefOfStaffService {
  return new ChiefOfStaffService(db);
}
