import { and, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { approvals } from "@nessie/db";
import { notFound, unprocessable } from "../errors.js";
import { callNessieProxy, type LlmUnavailable } from "./llm-call.js";

// Red Team / Blue Team debate generator.
//
// On any approval, the operator can request a "debate": Nessie synthesises
// a red-team argument (the strongest case AGAINST) and a blue-team argument
// (the strongest case FOR), then presents them side-by-side before the board
// signs. The MVP generator is template-based and content-aware so that we
// can ship without depending on a server-side LLM client. The actual
// generation function is isolated as `synthesiseArguments` so it can be
// swapped for a Claude call later without touching the route or the UI.

export interface DebateArgument {
  /** The argument body, plain text or light markdown. */
  argument: string;
  /** Optional agent identity that "spoke". For the templated generator this is unset. */
  agentId?: string | null;
  /** Three to five bullet points the argument is built from — surfaces concrete concerns / wins. */
  bullets: string[];
}

export interface ApprovalDebate {
  redTeam: DebateArgument;
  blueTeam: DebateArgument;
  generatedAt: string;
  generator: "template-v1" | "llm";
  status: "complete";
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Pure function: turns approval (type + payload) into a structured pair of
 * arguments. No side effects, no DB, no network. Easy to unit test and to
 * swap with a real LLM call.
 */
export function synthesiseArguments(input: {
  type: string;
  payload: Record<string, unknown>;
}): { red: DebateArgument; blue: DebateArgument } {
  const { type, payload } = input;

  if (type === "hire_agent") {
    const name = readString(payload.name) ?? "this candidate";
    const role = readString(payload.role) ?? "this role";
    const title = readString(payload.title);
    const budget = readNumber(payload.budgetMonthlyCents);
    const adapterType = readString(payload.adapterType);

    const redBullets = [
      `Headcount cost: hiring ${name}${budget && budget > 0 ? ` adds $${(budget / 100).toFixed(0)}/mo to fixed costs` : ` ties up payroll/credits without clear ROI`} before we've validated the role's leverage.`,
      `Role ambiguity: "${role}"${title ? ` (${title})` : ""} can overlap with the existing org — confirm there's no duplication with whoever already owns this scope.`,
      `Sequencing: hiring before the work is bottlenecked on a specific person tends to invent work for the hire to do, not the other way around.`,
      adapterType
        ? `Adapter risk: the ${adapterType} runtime should be proven on a smaller task before we commit budget to an agent that depends on it.`
        : `Adapter risk: pick the cheapest viable runtime first; we can upgrade if the work justifies it.`,
    ];

    const blueBullets = [
      `Leverage: ${name} closes a specific gap in "${role}"${title ? ` as ${title}` : ""} — the team can stop context-switching and the bottleneck is removed today.`,
      `Cost discipline: ${budget && budget > 0 ? `the $${(budget / 100).toFixed(0)}/mo budget is hard-capped` : `running with no fixed budget means we pay only for work that ships`}. Cheap to stop, expensive to delay.`,
      `Momentum: every week without this role is a week the goal hierarchy stalls. Hire fast, performance-review at 30 days, re-evaluate.`,
      `Reversibility: agent hires aren't permanent. If ${name} underperforms, the trust layer + reputation events make a 30-day decision easy.`,
    ];

    return {
      red: {
        bullets: redBullets,
        argument: `Don't hire ${name} yet. ${redBullets[0]} ${redBullets[2]}`,
      },
      blue: {
        bullets: blueBullets,
        argument: `Hire ${name} now. ${blueBullets[0]} ${blueBullets[2]}`,
      },
    };
  }

  if (type === "budget_override_required") {
    const amount = readNumber(payload.requestedAmountCents);
    const scope = readString(payload.scopeKind) ?? "this scope";
    const reason = readString(payload.reason);
    const amountDisplay = amount ? `$${(amount / 100).toFixed(0)}` : "the requested amount";

    const redBullets = [
      `Budget is the only hard guardrail we have — overriding it once normalises overriding it always.`,
      `${amountDisplay} on ${scope} is real money: it directly trades against headcount, runway, and other initiatives that already cleared review.`,
      reason
        ? `"${reason}" is a story, not a forecast — what's the leading indicator we'll watch to know whether the override paid back?`
        : `The override has no attached forecast. Approving without a payback hypothesis is gambling.`,
      `If the work matters, it matters more than its current frame: tighten scope to fit the existing budget instead of stretching the budget to fit the scope.`,
    ];

    const blueBullets = [
      `Hard-stopping at the budget line is what burns autonomy: the work in flight loses context every time we pause and resume.`,
      `${amountDisplay} unblocks ${scope} immediately. The cost of waiting is greater than the cost of overshoot.`,
      reason
        ? `The stated reason — "${reason}" — is the kind of fast-moving signal budget caps were never built to react to.`
        : `Approve with a cap and a check-in: override now, review actuals in 48h, hard-stop again if the curve doesn't bend.`,
      `Trust layer: the requester's reputation absorbs the risk. If they ask for more later without delivering, the next override is hard to justify.`,
    ];

    return {
      red: { bullets: redBullets, argument: `Hold the line. ${redBullets[0]} ${redBullets[2]}` },
      blue: { bullets: blueBullets, argument: `Approve the override. ${blueBullets[0]} ${blueBullets[1]}` },
    };
  }

  // Generic fallback. Still content-aware via the payload's prose-ish fields.
  const summary =
    readString(payload.title) ??
    readString(payload.summary) ??
    readString(payload.reason) ??
    readString(payload.description) ??
    `this ${type.replace(/_/g, " ")}`;

  const redBullets = [
    `Reversibility: how do we unwind "${summary}" if it turns out to be the wrong call?`,
    `Externalities: who's NOT in this approval thread that this still affects?`,
    `Sequencing: is this the highest-leverage thing we could approve right now, or just the next thing in the queue?`,
  ];
  const blueBullets = [
    `Cost of delay: every day "${summary}" sits in pending is a day the goal hierarchy is misaligned.`,
    `Bias for action: a small reversible decision now beats a perfect decision later.`,
    `Trust layer: the requester has skin in the game; approving compounds the relationship.`,
  ];

  return {
    red: { bullets: redBullets, argument: `Pause before approving "${summary}". ${redBullets[0]}` },
    blue: { bullets: blueBullets, argument: `Approve "${summary}". ${blueBullets[0]}` },
  };
}

/**
 * Try to coerce an LLM-produced JSON-ish blob into the {red, blue} shape
 * the UI expects. Returns null if the shape is wrong so the caller can
 * fall back to templates.
 */
function parseDebateJson(text: string): { red: DebateArgument; blue: DebateArgument } | null {
  // Models sometimes wrap JSON in ```json ... ```. Strip code fences.
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const red = obj.red ?? obj.redTeam;
  const blue = obj.blue ?? obj.blueTeam;
  if (!red || !blue || typeof red !== "object" || typeof blue !== "object") return null;

  const coerceArg = (input: unknown): DebateArgument | null => {
    if (!input || typeof input !== "object") return null;
    const o = input as Record<string, unknown>;
    const argument = typeof o.argument === "string" ? o.argument : null;
    const bullets = Array.isArray(o.bullets) ? o.bullets.filter((b): b is string => typeof b === "string") : [];
    if (!argument || bullets.length === 0) return null;
    return { argument, bullets };
  };

  const redArg = coerceArg(red);
  const blueArg = coerceArg(blue);
  if (!redArg || !blueArg) return null;
  return { red: redArg, blue: blueArg };
}

function buildDebatePrompt(input: { type: string; payload: Record<string, unknown> }) {
  return [
    {
      role: "system" as const,
      content:
        "You are Nessie, the AI control plane for an autonomous company. The operator (human board) wants a structured debate before signing an approval. Produce the strongest argument AGAINST (red team) and the strongest argument FOR (blue team). Lean on the approval's concrete payload — name agents, dollar amounts, roles. Be terse and useful. Output JSON ONLY, no prose, no code fences:\n{\n  \"red\": { \"argument\": \"single-paragraph case against (under 280 chars)\", \"bullets\": [\"3-4 concrete bullet points\"] },\n  \"blue\": { \"argument\": \"single-paragraph case for (under 280 chars)\", \"bullets\": [\"3-4 concrete bullet points\"] }\n}",
    },
    {
      role: "user" as const,
      content: `Approval type: ${input.type}\nPayload:\n${JSON.stringify(input.payload, null, 2)}`,
    },
  ];
}

export function approvalDebateService(db: Db) {
  return {
    /**
     * Generate a debate for the given approval and persist it onto the
     * approval's payload under the `debate` key. Calls the Nessie cost-tier
     * proxy for a real LLM-driven debate; falls back to a templated debate
     * when no credentials are available.
     */
    async generate(approvalId: string): Promise<{ debate: ApprovalDebate; warning?: string }> {
      const existing = await db
        .select()
        .from(approvals)
        .where(eq(approvals.id, approvalId))
        .then((rows) => rows[0] ?? null);
      if (!existing) throw notFound("Approval not found");

      const payload = (existing.payload ?? {}) as Record<string, unknown>;

      // Real LLM call via the cost-tier proxy.
      const llm = await callNessieProxy({
        companyId: existing.companyId,
        messages: buildDebatePrompt({ type: existing.type, payload }),
        temperature: 0.7,
        maxTokens: 800,
      });

      let red: DebateArgument;
      let blue: DebateArgument;
      let generator: ApprovalDebate["generator"] = "template-v1";
      let warning: string | undefined;

      if (llm.ok) {
        const parsed = parseDebateJson(llm.text);
        if (parsed) {
          red = parsed.red;
          blue = parsed.blue;
          generator = "llm";
        } else {
          // LLM returned malformed JSON — fall back to template but tell the operator.
          const fallback = synthesiseArguments({ type: existing.type, payload });
          red = fallback.red;
          blue = fallback.blue;
          warning = `LLM returned unparseable output; showing template instead.`;
        }
      } else {
        // No LLM available — fall back to templated arguments + a clear notice.
        const fallback = synthesiseArguments({ type: existing.type, payload });
        red = fallback.red;
        blue = fallback.blue;
        warning = (llm as LlmUnavailable).fix;
      }

      const debate: ApprovalDebate = {
        redTeam: red,
        blueTeam: blue,
        generatedAt: new Date().toISOString(),
        generator,
        status: "complete",
      };

      const { debate: _drop, ...payloadRest } = payload;
      const nextPayload: Record<string, unknown> = { ...payloadRest, debate };

      const now = new Date();
      await db
        .update(approvals)
        .set({ payload: nextPayload, updatedAt: now })
        .where(and(eq(approvals.id, approvalId)));

      return { debate, warning };
    },
  };
}
