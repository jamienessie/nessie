import { and, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { agents, candidates, hires, meetingMessages, meetings, roleTemplates } from "@nessie/db";
import { ROLE_TEMPLATES } from "../onboarding-assets/role-templates.js";
import { findAgentForOneShot, runOneShotAdapterCall } from "./llm-one-shot.js";
import { hiresService } from "./hires.js";

// HR orchestrator.
//
// Owns the AI-driven side of the hiring pipeline: ensures Lena Park
// (Head of HR) exists, generates candidate personas from a job brief,
// and synthesises post-interview scorecards from meeting transcripts.
//
// Lena's adapter resolution prefers `azure_openai` (since that's what's
// actually wired up on this machine), falling back to whatever the
// operator has configured.

const HR_TEMPLATE_KEY = "hr.head";

interface CandidatePersona {
  humanFirstName: string;
  humanLastName: string;
  title: string;
  summary: string;
  resumeMarkdown: string;
  proposedAdapterType?: string;
}

/**
 * Find or create the company's HR agent (Lena Park · Head of HR).
 * Idempotent — safe to call from any endpoint.
 *
 * Uses the `hr.head` role template for naming defaults but overrides
 * `defaultAdapterType` to `azure_openai` when an azure_openai-capable
 * agent already exists in the company (so Lena can immediately work).
 */
export async function ensureHrAgent(db: Db, companyId: string): Promise<string> {
  // Already exists?
  const existing = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.role, "hr")))
    .limit(1);
  if (existing[0]) return existing[0].id;

  // Use the seeded role-template defaults. Override adapter type to
  // azure_openai if any other agent in the company already runs it
  // (so Lena inherits a working backbone). Otherwise honour the
  // template's default.
  const tmpl = ROLE_TEMPLATES.find((t) => t.key === HR_TEMPLATE_KEY);
  if (!tmpl) throw new Error(`role template "${HR_TEMPLATE_KEY}" not seeded`);

  const otherAdapters = await db
    .select({ adapterType: agents.adapterType, adapterConfig: agents.adapterConfig })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.adapterType, "azure_openai")))
    .limit(1);
  const adapterType = otherAdapters[0]?.adapterType ?? tmpl.defaultAdapterType;
  const adapterConfig = otherAdapters[0]?.adapterConfig
    ?? (adapterType === "azure_openai" ? { model: "o4-mini" } : {});

  const [created] = await db
    .insert(agents)
    .values({
      companyId,
      humanFirstName: tmpl.defaultFirstName,
      humanLastName: tmpl.defaultLastName,
      name: `${tmpl.defaultFirstName} ${tmpl.defaultLastName}`,
      title: tmpl.title,
      role: "hr",
      tier: tmpl.tier,
      autonomyLevel: tmpl.defaultAutonomyLevel,
      adapterType,
      adapterConfig: adapterConfig as Record<string, unknown>,
      status: "active",
      reputationScore: 50,
    })
    .returning({ id: agents.id });

  console.log(`[hr-orchestrator] auto-seeded Lena Park · Head of HR (${created.id})`);
  return created.id;
}

/**
 * Best-effort JSON extraction from an LLM response. Falls back to
 * grabbing the first balanced `[` / `]` block if the response wraps
 * the JSON in prose.
 */
function extractJsonArray(text: string): unknown[] | null {
  const stripped = text.trim();
  // Try direct parse first.
  try {
    const parsed = JSON.parse(stripped);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    /* keep trying */
  }
  // Look for a fenced block.
  const fenceMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const inner = JSON.parse(fenceMatch[1]);
      if (Array.isArray(inner)) return inner;
    } catch {
      /* keep trying */
    }
  }
  // Find the first `[` and matching `]`.
  const start = stripped.indexOf("[");
  const end = stripped.lastIndexOf("]");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(stripped.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* nothing else to do */
    }
  }
  return null;
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const stripped = text.trim();
  try {
    const parsed = JSON.parse(stripped);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch { /* */ }
  const fenceMatch = stripped.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const inner = JSON.parse(fenceMatch[1]);
      if (inner && typeof inner === "object" && !Array.isArray(inner)) {
        return inner as Record<string, unknown>;
      }
    } catch { /* */ }
  }
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(stripped.slice(start, end + 1));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch { /* */ }
  }
  return null;
}

function toPersona(raw: unknown): CandidatePersona | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const first = typeof r.humanFirstName === "string" ? r.humanFirstName.trim() : "";
  const last = typeof r.humanLastName === "string" ? r.humanLastName.trim() : "";
  const title = typeof r.title === "string" ? r.title.trim() : "";
  const summary = typeof r.summary === "string" ? r.summary.trim() : "";
  const resume = typeof r.resumeMarkdown === "string" ? r.resumeMarkdown : "";
  if (!first || !last || !title || !summary) return null;
  return {
    humanFirstName: first,
    humanLastName: last,
    title,
    summary,
    resumeMarkdown: resume,
    proposedAdapterType: typeof r.proposedAdapterType === "string" ? r.proposedAdapterType : undefined,
  };
}

/**
 * Generate `count` candidate personas via the HR agent's LLM.
 * Inserts them as `candidates` rows. Returns the inserted rows.
 */
export async function generateCandidates(input: {
  db: Db;
  companyId: string;
  hireId: string;
  count?: number;
}): Promise<{ ok: true; created: typeof candidates.$inferSelect[] } | { ok: false; error: string }> {
  const count = input.count ?? 3;
  const hireRows = await input.db
    .select()
    .from(hires)
    .where(and(eq(hires.companyId, input.companyId), eq(hires.id, input.hireId)))
    .limit(1);
  const hire = hireRows[0];
  if (!hire) return { ok: false, error: "hire not found" };

  // Look up the role template (if any) for additional context.
  let templatePitch: string | null = null;
  let templateTitle: string | null = null;
  if (hire.requestedRoleTemplateKey) {
    const tmplRow = await input.db
      .select({ pitch: roleTemplates.pitch, title: roleTemplates.title })
      .from(roleTemplates)
      .where(eq(roleTemplates.key, hire.requestedRoleTemplateKey))
      .limit(1);
    templatePitch = tmplRow[0]?.pitch ?? null;
    templateTitle = tmplRow[0]?.title ?? null;
  }

  const hrAgentId = await ensureHrAgent(input.db, input.companyId);

  // Pick a default adapter for personas: prefer azure_openai if any
  // exists, else fall back to whatever is available.
  const fallbackAgentId = await findAgentForOneShot({
    db: input.db,
    companyId: input.companyId,
    preferAdapterTypes: ["azure_openai", "openrouter_compatible", "openai_compatible"],
  });
  const fallbackAdapter = fallbackAgentId
    ? (await input.db
        .select({ adapterType: agents.adapterType })
        .from(agents)
        .where(eq(agents.id, fallbackAgentId))
        .limit(1))[0]?.adapterType ?? "azure_openai"
    : "azure_openai";

  const prompt = [
    `You are Lena Park, Head of HR. You're sourcing candidates for a hire request.`,
    "",
    `**Hire title:** ${hire.title}`,
    `**Requested tier:** ${hire.requestedTier}`,
    templateTitle ? `**Role template:** ${templateTitle} — ${templatePitch ?? ""}` : "",
    hire.description ? `**Operator's brief:**\n${hire.description}` : "",
    "",
    `Generate exactly ${count} candidate personas as a JSON array. Each candidate must be:`,
    "- A real-sounding human (diverse first + last name, no placeholder names)",
    "- Distinct from the others (different backgrounds, strengths, opinionated quirks)",
    "- A real person Lena would actually surface from a sourcing pool",
    "",
    "Each item must have these exact fields:",
    "```ts",
    "{",
    '  humanFirstName: string;',
    '  humanLastName: string;',
    '  title: string;             // their proposed title at the company',
    '  summary: string;           // 1-2 sentences, voicy not corporate',
    '  resumeMarkdown: string;    // 3-5 line markdown with bullets — past roles, strengths, edge',
    "}",
    "```",
    "",
    `Reply with ONLY the JSON array. No prose, no fences, no greetings.`,
  ].filter((line) => line !== "").join("\n");

  const result = await runOneShotAdapterCall({
    db: input.db,
    agentId: hrAgentId,
    prompt,
    timeoutMs: 60_000,
  });
  if (!result.ok) return { ok: false, error: `HR LLM call failed: ${result.error}` };

  const parsed = extractJsonArray(result.text);
  if (!parsed) {
    return { ok: false, error: `HR returned non-JSON output: ${result.text.slice(0, 200)}` };
  }
  const personas = parsed.map(toPersona).filter((p): p is CandidatePersona => p != null);
  if (personas.length === 0) {
    return { ok: false, error: "HR returned zero usable personas" };
  }

  const created: typeof candidates.$inferSelect[] = [];
  for (const persona of personas) {
    const [row] = await input.db
      .insert(candidates)
      .values({
        hireId: input.hireId,
        humanFirstName: persona.humanFirstName,
        humanLastName: persona.humanLastName,
        title: persona.title,
        summary: persona.summary,
        resumeMarkdown: persona.resumeMarkdown,
        sourceTemplateKey: hire.requestedRoleTemplateKey,
        proposedAdapterType: persona.proposedAdapterType ?? fallbackAdapter,
        status: "proposed",
      })
      .returning();
    created.push(row);
  }

  return { ok: true, created };
}

/**
 * Read the meeting transcript, ask the HR agent to score the interview
 * via a structured rubric, and persist a `scorecards` row. Operator
 * advances the candidate manually after reviewing the scorecard.
 */
export async function synthesizeScorecard(input: {
  db: Db;
  companyId: string;
  hireId: string;
  candidateId: string;
  meetingId: string;
}): Promise<{ ok: true; scorecard: typeof import("@nessie/db").scorecards.$inferSelect }
          | { ok: false; error: string }> {
  // Pull candidate + transcript.
  const candRows = await input.db
    .select()
    .from(candidates)
    .where(eq(candidates.id, input.candidateId))
    .limit(1);
  const candidate = candRows[0];
  if (!candidate) return { ok: false, error: "candidate not found" };

  const meetingRows = await input.db
    .select()
    .from(meetings)
    .where(and(eq(meetings.companyId, input.companyId), eq(meetings.id, input.meetingId)))
    .limit(1);
  const meeting = meetingRows[0];
  if (!meeting) return { ok: false, error: "meeting not found" };

  const messages = await input.db
    .select({
      turnIndex: meetingMessages.turnIndex,
      role: meetingMessages.role,
      bodyMarkdown: meetingMessages.bodyMarkdown,
    })
    .from(meetingMessages)
    .where(eq(meetingMessages.meetingId, input.meetingId))
    .orderBy(meetingMessages.turnIndex);

  const transcript = messages
    .filter((m) => m.role === "agent" || m.role === "operator")
    .map((m) => `[${m.role}] turn ${m.turnIndex}\n${m.bodyMarkdown.trim()}`)
    .join("\n\n---\n\n");

  const hrAgentId = await ensureHrAgent(input.db, input.companyId);

  const prompt = [
    `You are Lena Park, Head of HR. You just observed an interview for the role of ${candidate.title}.`,
    "",
    `**Candidate:** ${candidate.humanFirstName} ${candidate.humanLastName}`,
    `**Background:** ${candidate.summary ?? ""}`,
    "",
    `**Interview transcript:**`,
    transcript || "(no messages yet)",
    "",
    `Score the candidate against four standard criteria. Reply with ONLY a JSON object — no prose, no fences:`,
    "```ts",
    "{",
    '  rubric: [',
    '    { criterion: "Communication", weight: 0.25, score: 0-5, note: string },',
    '    { criterion: "Domain expertise", weight: 0.30, score: 0-5, note: string },',
    '    { criterion: "Independent judgement", weight: 0.25, score: 0-5, note: string },',
    '    { criterion: "Cultural fit", weight: 0.20, score: 0-5, note: string },',
    '  ],',
    '  recommendation: "strong_hire" | "hire" | "weak_hire" | "no_hire" | "strong_no_hire",',
    '  notes: string  // 2-3 sentences. Strengths first, then concerns. Specific, not generic.',
    "}",
    "```",
  ].join("\n");

  const result = await runOneShotAdapterCall({
    db: input.db,
    agentId: hrAgentId,
    prompt,
    timeoutMs: 45_000,
  });
  if (!result.ok) return { ok: false, error: `HR LLM call failed: ${result.error}` };

  const parsed = extractJsonObject(result.text);
  if (!parsed) {
    return { ok: false, error: `HR returned non-JSON output: ${result.text.slice(0, 200)}` };
  }
  type RubricRow = { criterion: string; weight: number; score: number; note?: string };
  const rubricRaw = Array.isArray(parsed.rubric) ? parsed.rubric : [];
  const rubric: RubricRow[] = [];
  for (const r of rubricRaw) {
    if (typeof r !== "object" || r === null || Array.isArray(r)) continue;
    const o = r as Record<string, unknown>;
    const criterion = typeof o.criterion === "string" ? o.criterion : null;
    const weight = typeof o.weight === "number" ? o.weight : null;
    const score = typeof o.score === "number" ? o.score : null;
    if (!criterion || weight == null || score == null) continue;
    const row: RubricRow = { criterion, weight, score };
    if (typeof o.note === "string") row.note = o.note;
    rubric.push(row);
  }
  if (rubric.length === 0) {
    return { ok: false, error: "HR returned no usable rubric rows" };
  }

  const recommendation = (typeof parsed.recommendation === "string"
    ? (parsed.recommendation as "strong_hire" | "hire" | "weak_hire" | "no_hire" | "strong_no_hire")
    : undefined);
  const notes = typeof parsed.notes === "string" ? parsed.notes : null;

  const svc = hiresService(input.db);
  const created = await svc.addScorecard({
    candidateId: input.candidateId,
    pass: "interview",
    rubric,
    recommendation,
    notes,
    scoredByAgentId: hrAgentId,
  });

  return { ok: true, scorecard: created };
}
