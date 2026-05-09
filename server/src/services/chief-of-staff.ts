import { and, desc, eq, gte, lt, ne, sql } from "drizzle-orm";
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
import { findAgentForOneShot, runOneShotAdapterCall } from "./llm-one-shot.js";

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
//
// Optional LLM enrichment: after the structured sections are built, an
// `azure_openai`-backed agent (or any preferred adapter) is asked to
// rewrite the canned `summary` as a 2–3 sentence executive briefing.
// The call is fail-open — if no LLM agent exists or the call errors,
// the canned summary stays. This keeps the page fast and predictable
// while letting the operator's preferred model speak when available.

export type ChiefSectionKind =
  | "agents"
  | "issues"
  | "meetings"
  | "costs"
  | "approvals"
  | "inbox"
  | "hires"
  | "generic";

export type ChiefSection = {
  heading: string;
  /** Discriminant so the UI can pick the right renderer. Optional for back-compat. */
  kind?: ChiefSectionKind;
  rows: Array<Record<string, unknown>>;
};

export type ChiefResponse = {
  intent: string;
  summary: string;
  /** When LLM enrichment ran, the original template summary is kept here for debugging / fallback. */
  templateSummary?: string;
  sections: ChiefSection[];
};

export interface ChiefDashboardCounts {
  blockedIssues: number;
  pendingApprovals: number;
  liveAgents: number;
  weekSpendCents: number;
  openContracts: number;
  lowRepAgents: number;
  todaysMeetingsCount: number;
}

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

  /**
   * Always-on counts for the Chief of Staff dashboard pane. The page
   * fetches these on mount + every 30s + on relevant live events.
   * Recent activity and today's meetings are fetched separately by the
   * client via the existing activityApi / meetingsApi.
   */
  async dashboard(ctx: { companyId: string }): Promise<ChiefDashboardCounts> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const [
      blockedIssuesRows,
      pendingApprovalRows,
      pendingOutcomeRows,
      liveAgentRows,
      weekSpendRows,
      openContractRows,
      lowRepRows,
      todaysMeetingRows,
    ] = await Promise.all([
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(issues)
        .where(and(eq(issues.companyId, ctx.companyId), eq(issues.status, "blocked"))),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(agentBusMessages)
        .where(
          and(
            eq(agentBusMessages.companyId, ctx.companyId),
            eq(agentBusMessages.kind, "operator_approval_request"),
            eq(agentBusMessages.status, "pending"),
          ),
        ),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(meetingOutcomes)
        .where(eq(meetingOutcomes.approvedByOperator, false)),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(agents)
        .where(and(eq(agents.companyId, ctx.companyId), eq(agents.status, "running"))),
      this.db
        .select({ cents: sql<number>`coalesce(sum(${costEvents.costCents}), 0)::int` })
        .from(costEvents)
        .where(and(eq(costEvents.companyId, ctx.companyId), gte(costEvents.occurredAt, sevenDaysAgo))),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(workContracts)
        .where(eq(workContracts.state, "active")),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(agents)
        .where(and(eq(agents.companyId, ctx.companyId), sql`${agents.reputationScore} < 40`)),
      this.db
        .select({ n: sql<number>`count(*)::int` })
        .from(meetings)
        .where(
          and(
            eq(meetings.companyId, ctx.companyId),
            // either currently live OR scheduled for today
            sql`(${meetings.state} in ('active', 'waiting_for_operator')
                 or (${meetings.scheduledAt} >= ${todayStart} and ${meetings.scheduledAt} < ${todayEnd}))`,
          ),
        ),
    ]);

    const blockedIssues = blockedIssuesRows[0]?.n ?? 0;
    const pendingApprovals =
      (pendingApprovalRows[0]?.n ?? 0) + (pendingOutcomeRows[0]?.n ?? 0);
    const liveAgents = liveAgentRows[0]?.n ?? 0;
    const weekSpendCents = weekSpendRows[0]?.cents ?? 0;
    const openContracts = openContractRows[0]?.n ?? 0;
    const lowRepAgents = lowRepRows[0]?.n ?? 0;
    const todaysMeetingsCount = todaysMeetingRows[0]?.n ?? 0;
    return {
      blockedIssues,
      pendingApprovals,
      liveAgents,
      weekSpendCents,
      openContracts,
      lowRepAgents,
      todaysMeetingsCount,
    };
  }

  async ask(command: string, ctx: { companyId: string }): Promise<ChiefResponse> {
    const intent = classifyIntent(command);
    const base = await this.dispatch(intent, command, ctx);
    if (intent === "default") return base;
    const enriched = await this.enrichSummary(base, command, ctx);
    return enriched;
  }

  private async dispatch(
    intent: string,
    command: string,
    ctx: { companyId: string },
  ): Promise<ChiefResponse> {
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

  /**
   * Best-effort LLM enrichment of the summary paragraph. Sends the
   * structured sections + the operator's question to a one-shot
   * adapter call and replaces `summary` with the model's reply. On any
   * failure (no agent available, adapter error, timeout) the original
   * template summary is preserved — never blocks the response.
   */
  private async enrichSummary(
    base: ChiefResponse,
    command: string,
    ctx: { companyId: string },
  ): Promise<ChiefResponse> {
    const templateSummary = base.summary;
    const agentId = await findAgentForOneShot({
      db: this.db,
      companyId: ctx.companyId,
      preferAdapterTypes: ["azure_openai", "openrouter_compatible", "openai_compatible"],
    });
    if (!agentId) return base;

    const sectionsBlock = base.sections
      .map((s) => {
        const rowsPreview = s.rows.length === 0
          ? "(empty)"
          : JSON.stringify(s.rows.slice(0, 12), null, 2);
        return `### ${s.heading} (${s.rows.length} row${s.rows.length === 1 ? "" : "s"})\n${rowsPreview}`;
      })
      .join("\n\n");

    const prompt = [
      "You are the operator's Chief of Staff for an AI company.",
      "The operator just asked you a question. We have already pulled the structured data needed to answer.",
      "Your job: write a tight 2–3 sentence executive briefing that calls out what matters. Be specific (cite numbers, names, identifiers). No fluff, no padding, no greeting.",
      "If the data is empty, say so plainly in one sentence.",
      "",
      `**Operator's question:** ${command}`,
      `**Detected intent:** ${base.intent}`,
      "",
      "**Structured data we gathered:**",
      sectionsBlock || "(no sections)",
      "",
      "Reply with the briefing only — no markdown headings, no JSON, no quotes around it.",
    ].join("\n");

    const result = await runOneShotAdapterCall({
      db: this.db,
      agentId,
      prompt,
      timeoutMs: 30_000,
    });
    if (!result.ok) {
      // Console-warn so it shows in dev logs, but never propagate.
      // eslint-disable-next-line no-console
      console.warn(`[chief-of-staff] LLM enrichment failed: ${result.error}`);
      return base;
    }
    return {
      ...base,
      summary: result.text.trim() || templateSummary,
      templateSummary,
    };
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
        { heading: "Agents running", kind: "agents", rows: activeAgents },
        { heading: "Pending bus messages", kind: "approvals", rows: pendingBus },
        { heading: "Live meetings", kind: "meetings", rows: liveMeetings },
      ],
    };
  }

  private async whatIsBlocked(ctx: { companyId: string }): Promise<ChiefResponse> {
    const blockedIssues = await this.db.select({
      id: issues.id, identifier: issues.identifier, title: issues.title, status: issues.status,
      priority: issues.priority, assigneeAgentId: issues.assigneeAgentId,
    })
      .from(issues).where(and(eq(issues.companyId, ctx.companyId), eq(issues.status, "blocked"))).limit(50);
    const policyChecks = await this.db.select({ id: agentBusMessages.id, kind: agentBusMessages.kind, payload: agentBusMessages.payload })
      .from(agentBusMessages).where(and(
        eq(agentBusMessages.companyId, ctx.companyId),
        eq(agentBusMessages.kind, "policy_check"),
        eq(agentBusMessages.status, "pending"),
      )).limit(20);
    const meetingsWaiting = await this.db.select({ id: meetings.id, title: meetings.title, state: meetings.state })
      .from(meetings).where(and(eq(meetings.companyId, ctx.companyId), eq(meetings.state, "waiting_for_operator"))).limit(20);
    return {
      intent: "what_is_blocked",
      summary: `${blockedIssues.length} blocked issue${blockedIssues.length === 1 ? "" : "s"}, ${policyChecks.length} pending policy check${policyChecks.length === 1 ? "" : "s"}, ${meetingsWaiting.length} meeting${meetingsWaiting.length === 1 ? "" : "s"} awaiting you.`,
      sections: [
        { heading: "Blocked issues", kind: "issues", rows: blockedIssues },
        { heading: "Pending policy checks", kind: "approvals", rows: policyChecks },
        { heading: "Meetings awaiting operator", kind: "meetings", rows: meetingsWaiting },
      ],
    };
  }

  private async whatNeedsApproval(ctx: { companyId: string }): Promise<ChiefResponse> {
    const approvalReqs = await this.db.select({ id: agentBusMessages.id, kind: agentBusMessages.kind, payload: agentBusMessages.payload, createdAt: agentBusMessages.createdAt })
      .from(agentBusMessages).where(and(
        eq(agentBusMessages.companyId, ctx.companyId),
        eq(agentBusMessages.kind, "operator_approval_request"),
        eq(agentBusMessages.status, "pending"),
      )).orderBy(desc(agentBusMessages.createdAt)).limit(50);
    const unapprovedOutcomes = await this.db.select({
      id: meetingOutcomes.id, kind: meetingOutcomes.kind, meetingId: meetingOutcomes.meetingId,
    }).from(meetingOutcomes).where(eq(meetingOutcomes.approvedByOperator, false)).limit(50);
    const recommendedHires = await this.db.select({ id: hires.id, title: hires.title, status: hires.status })
      .from(hires).where(and(eq(hires.companyId, ctx.companyId), eq(hires.status, "recommended"))).limit(20);
    return {
      intent: "what_needs_approval",
      summary: `${approvalReqs.length} operator-approval request${approvalReqs.length === 1 ? "" : "s"}, ${unapprovedOutcomes.length} unapproved meeting outcome${unapprovedOutcomes.length === 1 ? "" : "s"}, ${recommendedHires.length} hire${recommendedHires.length === 1 ? "" : "s"} ready for you.`,
      sections: [
        { heading: "Approval requests on the bus", kind: "approvals", rows: approvalReqs },
        { heading: "Meeting outcomes pending", kind: "approvals", rows: unapprovedOutcomes },
        { heading: "Hires ready to mint", kind: "hires", rows: recommendedHires },
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
      sections: [{ heading: "Spend by provider · billing type (7d)", kind: "costs", rows: totals }],
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
        { heading: "Inbox awaiting triage", kind: "inbox", rows: untriaged },
        { heading: "Active work contracts", kind: "generic", rows: dueContracts },
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
      sections: [{ heading: "Lowest reputation first", kind: "agents", rows: lowReputationAgents }],
    };
  }
}

export function chiefOfStaffService(db: Db): ChiefOfStaffService {
  return new ChiefOfStaffService(db);
}
