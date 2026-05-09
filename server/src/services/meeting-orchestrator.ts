import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { agents, meetings as meetingsTable } from "@nessie/db";
import { parseClaudeStreamJson } from "@nessie/adapter-claude-local/server";
import { parseCodexJsonl } from "@nessie/adapter-codex-local/server";
import { findActiveServerAdapter } from "../adapters/registry.js";
import { meetingsService, type MeetingState } from "./meetings.js";
import { publishLiveEvent } from "./live-events.js";

// Meeting orchestrator.
//
// Drives the live "free-flow" loop after the operator transitions a meeting
// to `active`. Picks the next attendee, builds a prompt from agenda + prior
// turns + the agent's role, calls their adapter, saves the response as a
// meeting message, then schedules the next turn until:
//   - meeting.state is no longer "active" (operator paused / synthesized)
//   - meeting.turnIndex reaches turnLimit
//   - meeting.spentCents reaches budgetCents (when budget > 0)
//   - an adapter call hard-fails twice in a row (transitions to failed)
//
// Each turn has its own runId (UUID) so adapter logs can be correlated
// later if we ever want to show stdout/stderr from a meeting turn.

interface MeetingMessageRow {
  id: string;
  meetingId: string;
  agentId: string | null;
  turnIndex: number;
  role: string;
  bodyMarkdown: string;
  costCents: number;
  createdAt: Date;
}

interface AgentRow {
  id: string;
  companyId: string;
  name: string;
  humanFirstName: string;
  humanLastName: string;
  title: string | null;
  adapterType: string;
  adapterConfig: Record<string, unknown>;
}

const TURN_DELAY_MS = 600;
const TURN_TIMEOUT_MS = 90_000;
const MAX_PRIOR_TURNS_IN_PROMPT = 30;

// Local-CLI adapters (claude_local, codex_local) stream structured
// JSONL events on stdout, not plain text. Each one has its own parser
// in the adapter package; the cloud-API adapters (openai_compatible,
// azure_openai, openrouter_compatible) just emit the assistant text
// directly. extractAssistantText routes to the right parser so the
// meeting transcript shows readable replies, not raw event JSON.
function extractAssistantText(adapterType: string, stdout: string): string {
  const trimmed = stdout.trim();
  if (!trimmed) return "";
  if (adapterType === "claude_local") {
    return parseClaudeStreamJson(stdout).summary || trimmed;
  }
  if (adapterType === "codex_local") {
    return parseCodexJsonl(stdout).summary || trimmed;
  }
  return trimmed;
}

function displayName(agent: AgentRow): string {
  const human = `${agent.humanFirstName} ${agent.humanLastName}`.trim();
  if (human && agent.title) return `${human} · ${agent.title}`;
  if (human) return human;
  return agent.name;
}

/** Format the prior turns into a transcript the LLM can read. */
function formatPriorTurns(prior: MeetingMessageRow[], agentNameById: Map<string, string>): string {
  const turns = prior.slice(-MAX_PRIOR_TURNS_IN_PROMPT);
  if (turns.length === 0) return "(no messages yet — you are the first to speak.)";
  return turns
    .map((m) => {
      const speaker = m.role === "operator"
        ? "Operator"
        : m.role === "system"
          ? "System"
          : m.agentId
            ? agentNameById.get(m.agentId) ?? "Unknown agent"
            : "Unknown";
      return `**${speaker}** (turn ${m.turnIndex}):\n${m.bodyMarkdown.trim()}`;
    })
    .join("\n\n---\n\n");
}

/** Build the prompt sent to an attendee's LLM adapter for one meeting turn. */
export function buildMeetingPrompt(input: {
  meetingTitle: string;
  agendaMarkdown: string | null;
  agent: AgentRow;
  agentRole: string;
  priorTurns: MeetingMessageRow[];
  agentNameById: Map<string, string>;
}): string {
  const agendaBlock = input.agendaMarkdown?.trim()
    ? `**Agenda:**\n${input.agendaMarkdown.trim()}`
    : "(no formal agenda)";
  const transcript = formatPriorTurns(input.priorTurns, input.agentNameById);
  const persona = displayName(input.agent);
  const roleLine = input.agentRole && input.agentRole !== "panel"
    ? `Your role in this meeting is **${input.agentRole}**.`
    : "";

  return [
    `You are ${persona}, attending a live meeting titled "${input.meetingTitle}".`,
    roleLine,
    "",
    agendaBlock,
    "",
    `**Conversation so far:**`,
    "",
    transcript,
    "",
    "**Your turn now.** Respond as yourself — concise, natural, in character. ",
    "If you agree, build on what was said. If you disagree, push back specifically. ",
    "If you have nothing to add right now, write exactly: `[pass]` and nothing else.",
  ].filter((line) => line !== "").join("\n");
}

/**
 * Pick the next agent to speak. Round-robin among non-observer participants,
 * skipping whoever spoke last (so two agents don't ping-pong).
 */
function pickNextSpeaker(
  participants: Array<{ agentId: string; role: string; leftAt: Date | null }>,
  priorMessages: MeetingMessageRow[],
): { agentId: string; role: string } | null {
  const eligible = participants.filter((p) => p.role !== "observer" && !p.leftAt);
  if (eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0];

  const lastAgentMessage = [...priorMessages].reverse().find((m) => m.role === "agent" && m.agentId);
  const lastAgentId = lastAgentMessage?.agentId ?? null;

  // Count turns each eligible agent has taken — pick the one with fewest, then by participant order.
  const turnCounts = new Map<string, number>();
  for (const m of priorMessages) {
    if (m.role !== "agent" || !m.agentId) continue;
    turnCounts.set(m.agentId, (turnCounts.get(m.agentId) ?? 0) + 1);
  }
  const sorted = [...eligible].sort((a, b) => {
    const ca = turnCounts.get(a.agentId) ?? 0;
    const cb = turnCounts.get(b.agentId) ?? 0;
    if (ca !== cb) return ca - cb;
    return 0;
  });
  // Prefer not-the-last-speaker if any candidate is tied for fewest turns.
  const notLast = sorted.find((p) => p.agentId !== lastAgentId);
  return notLast ?? sorted[0];
}

async function fetchAgent(db: Db, agentId: string): Promise<AgentRow | null> {
  const rows = await db.select().from(agents).where(eq(agents.id, agentId)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    humanFirstName: row.humanFirstName,
    humanLastName: row.humanLastName,
    title: row.title ?? null,
    adapterType: row.adapterType,
    adapterConfig: (row.adapterConfig ?? {}) as Record<string, unknown>,
  };
}

/**
 * Run a single agent turn. Calls the agent's adapter once, captures the text
 * output, saves it as a meeting message. Returns the saved message or an
 * error string.
 */
export async function runOneTurn(input: {
  db: Db;
  companyId: string;
  meetingId: string;
  agentId: string;
  agentRole: string;
}): Promise<{ ok: true; bodyMarkdown: string; costCents: number } | { ok: false; error: string }> {
  const svc = meetingsService(input.db);
  const meeting = await svc.get(input.companyId, input.meetingId);
  if (!meeting) return { ok: false, error: "meeting not found" };

  const [agent, prior, participants] = await Promise.all([
    fetchAgent(input.db, input.agentId),
    svc.listMessages(input.meetingId, { limit: 100 }),
    svc.listParticipants(input.meetingId),
  ]);
  if (!agent) return { ok: false, error: `agent ${input.agentId} not found` };

  const adapter = findActiveServerAdapter(agent.adapterType);
  if (!adapter) return { ok: false, error: `no active adapter for type "${agent.adapterType}"` };

  // Resolve names for everyone in the prior transcript.
  const agentIds = new Set<string>();
  for (const p of participants) agentIds.add(p.agentId);
  for (const m of prior) if (m.agentId) agentIds.add(m.agentId);
  const nameRows = agentIds.size > 0
    ? await Promise.all([...agentIds].map((id) => fetchAgent(input.db, id)))
    : [];
  const agentNameById = new Map<string, string>();
  for (const row of nameRows) {
    if (row) agentNameById.set(row.id, displayName(row));
  }

  const prompt = buildMeetingPrompt({
    meetingTitle: meeting.title,
    agendaMarkdown: meeting.agendaMarkdown ?? null,
    agent,
    agentRole: input.agentRole,
    priorTurns: prior as MeetingMessageRow[],
    agentNameById,
  });

  publishLiveEvent({
    companyId: input.companyId,
    type: "meeting.turn.starting",
    payload: { meetingId: input.meetingId, agentId: agent.id, agentName: displayName(agent) },
  });

  let stdout = "";
  let stderr = "";
  try {
    const executePromise = adapter.execute({
      runId: randomUUID(),
      agent: {
        id: agent.id,
        companyId: agent.companyId,
        name: agent.name,
        adapterType: agent.adapterType,
        adapterConfig: agent.adapterConfig,
      },
      runtime: { sessionId: null, sessionParams: null, sessionDisplayId: null, taskKey: null },
      config: agent.adapterConfig,
      context: { prompt },
      onLog: async (stream, chunk) => {
        if (stream === "stdout") stdout += chunk;
        else stderr += chunk;
      },
    });
    const result = await Promise.race([
      executePromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`turn timed out after ${TURN_TIMEOUT_MS / 1000}s`)), TURN_TIMEOUT_MS),
      ),
    ]);
    if (result.exitCode !== 0) {
      const message = result.errorMessage ?? stderr.trim() ?? `adapter exit ${result.exitCode}`;
      return { ok: false, error: message };
    }
    const bodyMarkdown = extractAssistantText(agent.adapterType, stdout);
    if (!bodyMarkdown) return { ok: false, error: "adapter produced empty response" };
    // Cost: prefer cost-per-turn from result if available, else 0.
    const costCents = typeof result.costUsd === "number" ? Math.round(result.costUsd * 100) : 0;
    return { ok: true, bodyMarkdown, costCents };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

interface AutoLoopState {
  cancelled: boolean;
}

const activeLoops = new Map<string, AutoLoopState>();

/** Stop any in-flight auto-loop for this meeting. Safe to call always. */
export function cancelAutoLoop(meetingId: string): void {
  const state = activeLoops.get(meetingId);
  if (state) state.cancelled = true;
}

/**
 * On server boot, resume auto-loops for any meetings still in `active` state.
 * Covers server restarts where the in-memory loop registry is lost. Safe to
 * call multiple times — startAutoLoop cancels any in-flight loop first.
 */
export async function resumeActiveAutoLoops(db: Db): Promise<void> {
  const rows = await db
    .select({ id: meetingsTable.id, companyId: meetingsTable.companyId })
    .from(meetingsTable)
    .where(eq(meetingsTable.state, "active"));
  if (rows.length === 0) return;
  console.log(`[meeting-loop] resuming ${rows.length} active meeting${rows.length === 1 ? "" : "s"}`);
  for (const row of rows) {
    startAutoLoop({ db, companyId: row.companyId, meetingId: row.id });
  }
}

/**
 * Kick off the auto-loop for a meeting. Returns immediately — the loop runs
 * in the background. Each turn:
 *   1. Re-read the meeting; if state != "active" or limits hit, stop.
 *   2. Pick next speaker (round-robin among non-observer attendees).
 *   3. Run their turn via adapter.
 *   4. Save message; broadcast event.
 *   5. Wait TURN_DELAY_MS, recurse.
 *
 * If a turn errors, we save a system message and try once more — second
 * failure transitions the meeting to `failed`.
 */
export function startAutoLoop(input: { db: Db; companyId: string; meetingId: string }): void {
  console.log(`[meeting-loop] start meetingId=${input.meetingId}`);
  // If a loop is already running for this meeting, cancel it and start fresh.
  cancelAutoLoop(input.meetingId);
  const state: AutoLoopState = { cancelled: false };
  activeLoops.set(input.meetingId, state);

  // Don't await — fire and forget.
  void runAutoLoop({ ...input, state }).catch((err) => {
    console.error("[meeting-loop] unhandled error", err);
  }).finally(() => {
    console.log(`[meeting-loop] exit meetingId=${input.meetingId}`);
    if (activeLoops.get(input.meetingId) === state) {
      activeLoops.delete(input.meetingId);
    }
  });
}

async function runAutoLoop(input: {
  db: Db;
  companyId: string;
  meetingId: string;
  state: AutoLoopState;
}): Promise<void> {
  const svc = meetingsService(input.db);
  // Track per-agent failure counts so an attendee with a broken adapter
  // (e.g. claude_local with no CLI installed) gets skipped after 2 misses
  // instead of poisoning the whole meeting.
  const failsByAgent = new Map<string, number>();
  const skipped = new Set<string>();
  const MAX_FAILS_PER_AGENT = 2;

  while (!input.state.cancelled) {
    const meeting = await svc.get(input.companyId, input.meetingId);
    if (!meeting) {
      console.log(`[meeting-loop] meeting not found ${input.meetingId}`);
      return;
    }
    if ((meeting.state as MeetingState) !== "active") {
      console.log(`[meeting-loop] state=${meeting.state} (not active) — exiting loop`);
      return;
    }
    if (meeting.turnLimit > 0 && meeting.turnIndex >= meeting.turnLimit) {
      // Hit turn limit — hand back to operator for synthesis.
      try {
        await svc.transition(input.companyId, input.meetingId, "waiting_for_operator");
      } catch {
        /* swallow — race with manual transition */
      }
      return;
    }
    if (meeting.budgetCents > 0 && meeting.spentCents >= meeting.budgetCents) {
      try {
        await svc.transition(input.companyId, input.meetingId, "waiting_for_operator");
      } catch {
        /* swallow */
      }
      return;
    }

    const participants = await svc.listParticipants(input.meetingId);
    const messages = await svc.listMessages(input.meetingId, { limit: 100 });
    const eligibleParticipants = participants
      .map((p) => ({ agentId: p.agentId, role: p.role, leftAt: p.leftAt ?? null }))
      .filter((p) => !skipped.has(p.agentId));
    const next = pickNextSpeaker(eligibleParticipants, messages as MeetingMessageRow[]);
    if (!next) {
      console.log(`[meeting-loop] no eligible speakers — exiting loop`);
      return;
    }

    console.log(`[meeting-loop] running turn for agent ${next.agentId} role=${next.role}`);
    const turn = await runOneTurn({
      db: input.db,
      companyId: input.companyId,
      meetingId: input.meetingId,
      agentId: next.agentId,
      agentRole: next.role,
    });
    console.log(`[meeting-loop] turn result ok=${turn.ok}${turn.ok ? "" : ` error=${turn.error}`}`);

    if (turn.ok) {
      failsByAgent.delete(next.agentId);
      const body = turn.bodyMarkdown.trim();
      // Treat "[pass]" as a no-op turn.
      if (body.toLowerCase() === "[pass]") {
        await svc.addMessage({
          meetingId: input.meetingId,
          agentId: next.agentId,
          role: "system",
          bodyMarkdown: `_${(await fetchAgent(input.db, next.agentId))?.name ?? "An attendee"} passed._`,
          costCents: 0,
        });
      } else {
        await svc.addMessage({
          meetingId: input.meetingId,
          agentId: next.agentId,
          role: "agent",
          bodyMarkdown: body,
          costCents: turn.costCents,
        });
      }
    } else {
      const fails = (failsByAgent.get(next.agentId) ?? 0) + 1;
      failsByAgent.set(next.agentId, fails);
      publishLiveEvent({
        companyId: input.companyId,
        type: "meeting.turn.failed",
        payload: { meetingId: input.meetingId, agentId: next.agentId, error: turn.error },
      });
      const agentRow = await fetchAgent(input.db, next.agentId);
      const agentLabel = agentRow ? agentRow.name : "An attendee";
      if (fails >= MAX_FAILS_PER_AGENT) {
        skipped.add(next.agentId);
        await svc.addMessage({
          meetingId: input.meetingId,
          agentId: next.agentId,
          role: "system",
          bodyMarkdown: `_${agentLabel} skipped — adapter (\`${agentRow?.adapterType ?? "unknown"}\`) failed ${fails}× : ${turn.error}_`,
          costCents: 0,
        });
        // If everyone is now skipped, drop back to operator.
        const stillEligible = participants.some(
          (p) => p.role !== "observer" && !p.leftAt && !skipped.has(p.agentId),
        );
        if (!stillEligible) {
          await svc.addMessage({
            meetingId: input.meetingId,
            agentId: null,
            role: "system",
            bodyMarkdown: "_All attendees have been skipped due to adapter errors. Returning to operator — try Pause + remove broken attendees, or fix their adapters._",
            costCents: 0,
          });
          try {
            await svc.transition(input.companyId, input.meetingId, "waiting_for_operator");
          } catch {
            /* swallow */
          }
          return;
        }
      } else {
        await svc.addMessage({
          meetingId: input.meetingId,
          agentId: next.agentId,
          role: "system",
          bodyMarkdown: `_${agentLabel} turn failed (${fails}/${MAX_FAILS_PER_AGENT}): ${turn.error}_`,
          costCents: 0,
        });
      }
    }

    // Cool down so the UI can render the new bubble before the next one arrives.
    await new Promise((resolve) => setTimeout(resolve, TURN_DELAY_MS));
  }
}
