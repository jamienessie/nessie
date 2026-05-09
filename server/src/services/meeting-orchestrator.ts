import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { agents, candidates, meetings as meetingsTable } from "@nessie/db";
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
const TURN_TIMEOUT_MS = 45_000;
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

// A meeting "speaker" is either a real agent or a candidate persona.
// We use a stable string key so the round-robin logic works uniformly.
type ParticipantSpeaker =
  | { kind: "agent"; agentId: string; role: string; leftAt: Date | null }
  | { kind: "candidate"; candidateId: string; role: string; leftAt: Date | null };

function speakerKey(s: ParticipantSpeaker): string {
  return s.kind === "agent" ? `a:${s.agentId}` : `c:${s.candidateId}`;
}

/**
 * Pick the next speaker to talk. Round-robin among non-observer participants,
 * skipping whoever spoke last (so two speakers don't ping-pong).
 */
function pickNextSpeaker(
  participants: ParticipantSpeaker[],
  priorMessages: MeetingMessageRow[],
): ParticipantSpeaker | null {
  const eligible = participants.filter((p) => p.role !== "observer" && !p.leftAt);
  if (eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0];

  const lastSpeakerMessage = [...priorMessages].reverse().find((m) => m.role === "agent" && m.agentId);
  const lastAgentId = lastSpeakerMessage?.agentId ?? null;

  // Count turns each eligible speaker has taken (agent-typed messages only;
  // candidate turns are also persisted as agent-role messages with the
  // host's agentId by design — see runOneTurn).
  const turnCounts = new Map<string, number>();
  for (const m of priorMessages) {
    if (m.role !== "agent" || !m.agentId) continue;
    turnCounts.set(m.agentId, (turnCounts.get(m.agentId) ?? 0) + 1);
  }
  const sorted = [...eligible].sort((a, b) => {
    const aId = a.kind === "agent" ? a.agentId : null;
    const bId = b.kind === "agent" ? b.agentId : null;
    const ca = aId ? (turnCounts.get(aId) ?? 0) : 0;
    const cb = bId ? (turnCounts.get(bId) ?? 0) : 0;
    if (ca !== cb) return ca - cb;
    return 0;
  });
  const notLast = sorted.find((p) => p.kind !== "agent" || p.agentId !== lastAgentId);
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

interface CandidateSpeakerRow {
  id: string;
  hireId: string;
  humanFirstName: string;
  humanLastName: string;
  title: string;
  summary: string | null;
  resumeMarkdown: string | null;
  proposedAdapterType: string | null;
}

async function fetchCandidate(db: Db, candidateId: string): Promise<CandidateSpeakerRow | null> {
  const rows = await db.select().from(candidates).where(eq(candidates.id, candidateId)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    hireId: row.hireId,
    humanFirstName: row.humanFirstName,
    humanLastName: row.humanLastName,
    title: row.title,
    summary: row.summary,
    resumeMarkdown: row.resumeMarkdown,
    proposedAdapterType: row.proposedAdapterType,
  };
}

/**
 * Build an AgentRow shim for a candidate persona so they can speak in a
 * meeting. The adapter type comes from the candidate's `proposedAdapterType`
 * (which the HR orchestrator picks at generation time, defaulting to
 * azure_openai). The adapter config is borrowed from any existing agent
 * in the company that runs the same adapter type — gives the candidate
 * a working backbone without needing their own setup.
 */
async function buildCandidateAgentShim(
  db: Db,
  companyId: string,
  candidate: CandidateSpeakerRow,
): Promise<AgentRow | null> {
  const adapterType = candidate.proposedAdapterType ?? "azure_openai";
  // Borrow adapterConfig from any agent in the company running this adapter.
  const sibling = await db
    .select({ adapterConfig: agents.adapterConfig })
    .from(agents)
    .where(eq(agents.companyId, companyId))
    .limit(20);
  const matched = sibling.find(() => true) ?? null;
  const adapterConfig = (matched?.adapterConfig ?? {}) as Record<string, unknown>;
  // Default model fallback for azure_openai.
  if (adapterType === "azure_openai" && !adapterConfig.model) {
    adapterConfig.model = "o4-mini";
  }
  return {
    id: candidate.id,
    companyId,
    name: `${candidate.humanFirstName} ${candidate.humanLastName}`,
    humanFirstName: candidate.humanFirstName,
    humanLastName: candidate.humanLastName,
    title: candidate.title,
    adapterType,
    adapterConfig,
  };
}

/**
 * Run a single speaker turn. The speaker is either a real agent or a
 * candidate persona; the orchestrator builds the right adapter context
 * either way. Calls the adapter once, captures the text output, saves
 * it as a meeting message. Returns the saved message or an error.
 */
export async function runOneTurn(input: {
  db: Db;
  companyId: string;
  meetingId: string;
  agentRole: string;
} & ({ agentId: string; candidateId?: undefined } | { agentId?: undefined; candidateId: string })): Promise<
  | { ok: true; bodyMarkdown: string; costCents: number }
  | { ok: false; error: string; terminal?: boolean }
> {
  const svc = meetingsService(input.db);
  const meeting = await svc.get(input.companyId, input.meetingId);
  if (!meeting) return { ok: false, error: "meeting not found" };

  // Resolve the agent shim for this speaker. For agents, fetch directly;
  // for candidates, fetch the candidate row and build a transient shim
  // that targets their proposedAdapterType.
  let agent: AgentRow | null = null;
  let candidatePersona: CandidateSpeakerRow | null = null;
  if (input.agentId) {
    agent = await fetchAgent(input.db, input.agentId);
    if (!agent) return { ok: false, error: `agent ${input.agentId} not found` };
  } else if (input.candidateId) {
    const cId = input.candidateId;
    candidatePersona = await fetchCandidate(input.db, cId);
    if (!candidatePersona) return { ok: false, error: `candidate ${cId} not found` };
    agent = await buildCandidateAgentShim(input.db, input.companyId, candidatePersona);
    if (!agent) return { ok: false, error: `cannot build shim for candidate ${cId}` };
  } else {
    return { ok: false, error: "agentId or candidateId required" };
  }

  const [prior, participants] = await Promise.all([
    svc.listMessages(input.meetingId, { limit: 100 }),
    svc.listParticipants(input.meetingId),
  ]);

  const adapter = findActiveServerAdapter(agent.adapterType);
  if (!adapter) return { ok: false, error: `no active adapter for type "${agent.adapterType}"` };

  // Resolve names for everyone in the prior transcript. Participants
  // can be either agents or candidates — pull both sources.
  const agentIds = new Set<string>();
  const candidateIds = new Set<string>();
  for (const p of participants) {
    if (p.agentId) agentIds.add(p.agentId);
    if (p.candidateId) candidateIds.add(p.candidateId);
  }
  for (const m of prior) if (m.agentId) agentIds.add(m.agentId);
  const [agentNameRows, candidateNameRows] = await Promise.all([
    agentIds.size > 0
      ? Promise.all([...agentIds].map((id) => fetchAgent(input.db, id)))
      : Promise.resolve([]),
    candidateIds.size > 0
      ? Promise.all([...candidateIds].map((id) => fetchCandidate(input.db, id)))
      : Promise.resolve([]),
  ]);
  const agentNameById = new Map<string, string>();
  for (const row of agentNameRows) {
    if (row) agentNameById.set(row.id, displayName(row));
  }
  for (const row of candidateNameRows) {
    if (row) {
      const human = `${row.humanFirstName} ${row.humanLastName}`.trim();
      const label = row.title ? `${human} · ${row.title}` : human;
      agentNameById.set(row.id, `${label} (candidate)`);
    }
  }

  const baseAgendaMd = meeting.agendaMarkdown ?? null;
  // For candidates, pin a persona block at the top of the prompt so they
  // answer in character. The HR agent's prompt is unchanged.
  let agendaMarkdown = baseAgendaMd;
  if (candidatePersona) {
    const personaBlock = [
      `**You are interviewing for the role of ${candidatePersona.title}.**`,
      candidatePersona.summary ? `Background: ${candidatePersona.summary}` : "",
      candidatePersona.resumeMarkdown ? `Resume:\n${candidatePersona.resumeMarkdown}` : "",
      `Stay in character as ${candidatePersona.humanFirstName} ${candidatePersona.humanLastName}. Answer naturally — don't break the fourth wall, don't introduce yourself in third person.`,
    ].filter((s) => s.length > 0).join("\n\n");
    agendaMarkdown = baseAgendaMd ? `${personaBlock}\n\n---\n\n${baseAgendaMd}` : personaBlock;
  }

  const prompt = buildMeetingPrompt({
    meetingTitle: meeting.title,
    agendaMarkdown,
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
    // Timeouts are a strong signal the adapter is hung (likely waiting on
    // a permission prompt for claude_local without dangerouslySkipPermissions,
    // or a misconfigured env). Mark terminal so the loop drops the agent
    // instead of burning more turns on them.
    const terminal = /timed out/i.test(message);
    return { ok: false, error: message, terminal };
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
    const eligibleParticipants: ParticipantSpeaker[] = [];
    for (const p of participants) {
      if (p.agentId) {
        if (!skipped.has(`a:${p.agentId}`)) {
          eligibleParticipants.push({ kind: "agent", agentId: p.agentId, role: p.role, leftAt: p.leftAt ?? null });
        }
      } else if (p.candidateId) {
        if (!skipped.has(`c:${p.candidateId}`)) {
          eligibleParticipants.push({ kind: "candidate", candidateId: p.candidateId, role: p.role, leftAt: p.leftAt ?? null });
        }
      }
    }
    const next = pickNextSpeaker(eligibleParticipants, messages as MeetingMessageRow[]);
    if (!next) {
      console.log(`[meeting-loop] no eligible speakers — exiting loop`);
      return;
    }

    const speakerLabel = next.kind === "agent" ? `agent ${next.agentId}` : `candidate ${next.candidateId}`;
    console.log(`[meeting-loop] running turn for ${speakerLabel} role=${next.role}`);
    const turn = next.kind === "agent"
      ? await runOneTurn({
          db: input.db,
          companyId: input.companyId,
          meetingId: input.meetingId,
          agentId: next.agentId,
          agentRole: next.role,
        })
      : await runOneTurn({
          db: input.db,
          companyId: input.companyId,
          meetingId: input.meetingId,
          candidateId: next.candidateId,
          agentRole: next.role,
        });
    console.log(`[meeting-loop] turn result ok=${turn.ok}${turn.ok ? "" : ` error=${turn.error}`}`);

    const speakerKeyStr = speakerKey(next);
    // Stable agentId column for messages: real agent uses their id, candidates
    // are persisted with agentId=null (their identity comes from the
    // candidate participant; the message body is what matters).
    const messageAgentId = next.kind === "agent" ? next.agentId : null;

    if (turn.ok) {
      failsByAgent.delete(speakerKeyStr);
      const body = turn.bodyMarkdown.trim();
      const speakerLabel = next.kind === "agent"
        ? (await fetchAgent(input.db, next.agentId))?.name ?? "An attendee"
        : (await fetchCandidate(input.db, next.candidateId))?.humanFirstName ?? "Candidate";
      // Treat "[pass]" as a no-op turn.
      if (body.toLowerCase() === "[pass]") {
        await svc.addMessage({
          meetingId: input.meetingId,
          agentId: messageAgentId,
          role: "system",
          bodyMarkdown: `_${speakerLabel} passed._`,
          costCents: 0,
        });
      } else {
        // For candidates, prefix the body with their name so the transcript
        // shows whose turn it is (since agentId is null on the row).
        const finalBody = next.kind === "candidate"
          ? `**${speakerLabel} (candidate):** ${body}`
          : body;
        await svc.addMessage({
          meetingId: input.meetingId,
          agentId: messageAgentId,
          role: "agent",
          bodyMarkdown: finalBody,
          costCents: turn.costCents,
        });
      }
    } else {
      const fails = (failsByAgent.get(speakerKeyStr) ?? 0) + 1;
      failsByAgent.set(speakerKeyStr, fails);
      publishLiveEvent({
        companyId: input.companyId,
        type: "meeting.turn.failed",
        payload: {
          meetingId: input.meetingId,
          agentId: messageAgentId,
          candidateId: next.kind === "candidate" ? next.candidateId : null,
          error: turn.error,
        },
      });
      const speakerLabel = next.kind === "agent"
        ? (await fetchAgent(input.db, next.agentId))?.name ?? "An attendee"
        : (await fetchCandidate(input.db, next.candidateId))?.humanFirstName ?? "Candidate";
      const adapterLabel = next.kind === "agent"
        ? (await fetchAgent(input.db, next.agentId))?.adapterType ?? "unknown"
        : (await fetchCandidate(input.db, next.candidateId))?.proposedAdapterType ?? "unknown";
      if (turn.terminal || fails >= MAX_FAILS_PER_AGENT) {
        skipped.add(speakerKeyStr);
        await svc.addMessage({
          meetingId: input.meetingId,
          agentId: messageAgentId,
          role: "system",
          bodyMarkdown: `_${speakerLabel} skipped — adapter (\`${adapterLabel}\`) failed ${fails}× : ${turn.error}_`,
          costCents: 0,
        });
        // If everyone is now skipped, drop back to operator.
        const stillEligible = participants.some((p) => {
          if (p.role === "observer" || p.leftAt) return false;
          const key = p.agentId ? `a:${p.agentId}` : p.candidateId ? `c:${p.candidateId}` : null;
          return key != null && !skipped.has(key);
        });
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
          agentId: messageAgentId,
          role: "system",
          bodyMarkdown: `_${speakerLabel} turn failed (${fails}/${MAX_FAILS_PER_AGENT}): ${turn.error}_`,
          costCents: 0,
        });
      }
    }

    // Cool down so the UI can render the new bubble before the next one arrives.
    await new Promise((resolve) => setTimeout(resolve, TURN_DELAY_MS));
  }
}
