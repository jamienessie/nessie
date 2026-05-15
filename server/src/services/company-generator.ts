import type { Db } from "@nessie/db";
import {
  agentService,
  companyService,
  goalService,
  logActivity,
} from "./index.js";
import { seedDefaultDepartments } from "./departments.js";
import { callNessieProxy } from "./llm-call.js";

// Company Generator — "boot a company in 60 seconds" feature.
//
// Takes a single paragraph from the operator ("I'm building a B2B SaaS for
// dentists, $20K MRR target in 6 months"), turns it into a working company:
// org chart, founding team, goal, and starter issues. The MVP synthesises
// the manifest from templates so it can ship without a server-side LLM
// client; the `buildManifest` function is the seam where an actual Claude
// call goes later.

export interface GeneratorPreferences {
  /** Hard ceiling for the new company's monthly budget. 0 = unlimited. */
  budgetMonthlyCents?: number;
  /** How aggressive the founding team should be. */
  autonomyLevel?: 1 | 2 | 3 | 4 | 5;
  /** Preferred adapter type for the founding agents. */
  adapterType?: string;
}

interface AgentSpec {
  slug: string;
  firstName: string;
  lastName: string;
  title: string;
  role: string;
  tier: "T1" | "T2" | "T3";
  reportsToSlug: string | null;
  capabilities: string;
  roleTemplateKey: string;
  departmentKey: string;
}

interface IssueSpec {
  title: string;
  description: string;
  assigneeSlug: string;
  priority: "critical" | "high" | "medium" | "low";
}

interface GeneratedCompanyManifest {
  companyName: string;
  description: string;
  topLevelGoal: { title: string; description: string };
  agents: AgentSpec[];
  starterIssues: IssueSpec[];
}

// Extract a plausible company name from the operator's prompt. Falls back to
// "New Company" if nothing reasonable can be lifted. This is intentionally
// stupid-simple; an LLM-backed generator would obviously do better.
function deriveCompanyName(prompt: string): string {
  const m = prompt.match(/(?:building|launching|creating|starting)\s+(?:a|an|the)\s+([A-Z][\w\s&.'-]{2,60}?)(?:[.,;:]|\s+(?:for|to|that|which|so|because)|$)/i);
  if (m && m[1]) return m[1].trim().replace(/\s+/g, " ");
  const firstSentence = prompt.split(/[.!?]/)[0] ?? "";
  const words = firstSentence.split(/\s+/).filter((w) => /^[A-Z][a-z]+$/.test(w)).slice(0, 3);
  if (words.length >= 2) return words.join(" ");
  return "New Company";
}

const FOUNDING_TEAM: AgentSpec[] = [
  {
    slug: "ceo",
    firstName: "Aria",
    lastName: "Whitfield",
    title: "CEO",
    role: "executive",
    tier: "T1",
    reportsToSlug: null,
    capabilities: "Holds the mission. Prioritises across departments. Approves hires, big spend, and strategic pivots.",
    roleTemplateKey: "exec.ceo",
    departmentKey: "exec",
  },
  {
    slug: "cto",
    firstName: "Marcus",
    lastName: "Chen",
    title: "CTO",
    role: "executive",
    tier: "T1",
    reportsToSlug: "ceo",
    capabilities: "Owns architecture. Delegates code work to engineering. Makes the build-vs-buy calls.",
    roleTemplateKey: "exec.cto",
    departmentKey: "exec",
  },
  {
    slug: "eng-founder",
    firstName: "Priya",
    lastName: "Patel",
    title: "Founding Engineer",
    role: "engineer",
    tier: "T2",
    reportsToSlug: "cto",
    capabilities: "Builds the product. Ships the first features. Trades polish for speed in week one.",
    roleTemplateKey: "eng.ic",
    departmentKey: "eng",
  },
  {
    slug: "cmo",
    firstName: "Naomi",
    lastName: "Okafor",
    title: "CMO",
    role: "executive",
    tier: "T1",
    reportsToSlug: "ceo",
    capabilities: "Owns positioning, narrative, and growth. Writes copy, runs experiments, watches the funnel.",
    roleTemplateKey: "exec.cmo",
    departmentKey: "exec",
  },
  {
    slug: "designer",
    firstName: "Jules",
    lastName: "Hartman",
    title: "Founding Designer",
    role: "designer",
    tier: "T2",
    reportsToSlug: "ceo",
    capabilities: "Owns the look and feel. Ships the first design system. Pushes for simpler, fewer-screens flows.",
    roleTemplateKey: "prod.designer",
    departmentKey: "prod",
  },
];

function buildTemplateManifest(prompt: string, _prefs: GeneratorPreferences): GeneratedCompanyManifest {
  const companyName = deriveCompanyName(prompt);
  const description = prompt.length > 280 ? prompt.slice(0, 277) + "…" : prompt;

  return {
    companyName,
    description,
    topLevelGoal: {
      title: `Make ${companyName} real`,
      description: prompt,
    },
    agents: FOUNDING_TEAM,
    starterIssues: [
      {
        title: "Decide on the one-week wedge",
        description:
          "Pick the single smallest version of the product we can ship in 7 days that proves the core hypothesis. Write the answer in a comment and tag everyone.",
        assigneeSlug: "ceo",
        priority: "critical",
      },
      {
        title: "Stand up the technical spine",
        description:
          "Choose stack, set up the repo, get CI/CD + preview deploys working, and write a one-paragraph architecture decision record.",
        assigneeSlug: "cto",
        priority: "critical",
      },
      {
        title: "Ship the first vertical slice",
        description:
          "Land the smallest user-visible thing that proves the wedge: one page, one happy path, one button that does the thing. Deploy preview required.",
        assigneeSlug: "eng-founder",
        priority: "high",
      },
      {
        title: "Draft the landing-page narrative",
        description:
          "Write the headline, the sub-headline, and the three benefit bullets. Keep it the kind of thing a real customer would forward to a friend.",
        assigneeSlug: "cmo",
        priority: "high",
      },
      {
        title: "Design the first 3 screens end-to-end",
        description:
          "Mockups for landing, onboarding, and the core action. Lean on the system, no custom one-offs. Output: Figma link + screenshots.",
        assigneeSlug: "designer",
        priority: "high",
      },
    ],
  };
}

export interface GenerationResult {
  companyId: string;
  companyName: string;
  topLevelGoalId: string | null;
  agents: { id: string; slug: string; name: string; title: string }[];
  issues: { id: string; title: string }[];
  manifest: GeneratedCompanyManifest;
  /** Either "llm" or "template" — tells the operator whether real AI ran. */
  source: "llm" | "template";
  /** When the template fallback was used, this explains why. */
  warning: string | null;
}

const STARTER_ISSUE_PRIORITIES: ReadonlySet<IssueSpec["priority"]> = new Set([
  "critical",
  "high",
  "medium",
  "low",
]);

function coerceManifestFromLlm(prompt: string, raw: string): GeneratedCompanyManifest | null {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const companyName = typeof obj.companyName === "string" && obj.companyName.trim().length > 0
    ? obj.companyName.trim()
    : null;
  const description = typeof obj.description === "string" ? obj.description.trim() : null;
  const topLevelGoal = obj.topLevelGoal as { title?: unknown; description?: unknown } | undefined;
  if (
    !companyName ||
    !description ||
    !topLevelGoal ||
    typeof topLevelGoal.title !== "string" ||
    typeof topLevelGoal.description !== "string"
  ) {
    return null;
  }

  // Agents — keep the canonical 5-slug shape so reportsTo wiring stays stable.
  // We let the LLM rewrite names/titles/capabilities; the slugs and templates
  // remain so the rest of the seeding pipeline can run unmodified.
  const llmAgents = Array.isArray(obj.agents) ? (obj.agents as Record<string, unknown>[]) : [];
  const agents = FOUNDING_TEAM.map<AgentSpec>((seed) => {
    const override = llmAgents.find((a) => typeof a.slug === "string" && a.slug === seed.slug);
    if (!override) return seed;
    return {
      ...seed,
      firstName: typeof override.firstName === "string" && override.firstName.trim() ? override.firstName.trim() : seed.firstName,
      lastName: typeof override.lastName === "string" && override.lastName.trim() ? override.lastName.trim() : seed.lastName,
      title: typeof override.title === "string" && override.title.trim() ? override.title.trim() : seed.title,
      capabilities:
        typeof override.capabilities === "string" && override.capabilities.trim()
          ? override.capabilities.trim()
          : seed.capabilities,
    };
  });

  // Starter issues — accept anything that looks plausible, fall back if not.
  const llmIssues = Array.isArray(obj.starterIssues) ? (obj.starterIssues as Record<string, unknown>[]) : [];
  const validSlugs = new Set(agents.map((a) => a.slug));
  const starterIssues = llmIssues
    .map((entry): IssueSpec | null => {
      const title = typeof entry.title === "string" ? entry.title.trim() : "";
      const description2 = typeof entry.description === "string" ? entry.description.trim() : "";
      const assigneeSlug = typeof entry.assigneeSlug === "string" ? entry.assigneeSlug : "";
      const priorityRaw = typeof entry.priority === "string" ? entry.priority.toLowerCase() : "";
      const priority = (STARTER_ISSUE_PRIORITIES.has(priorityRaw as IssueSpec["priority"])
        ? priorityRaw
        : "high") as IssueSpec["priority"];
      if (!title || !description2 || !validSlugs.has(assigneeSlug)) return null;
      return { title, description: description2, assigneeSlug, priority };
    })
    .filter((entry): entry is IssueSpec => entry !== null)
    .slice(0, 7);

  if (starterIssues.length < 3) {
    // Not enough good starter issues — fall back so the company boots with real work.
    return null;
  }

  return {
    companyName,
    description: description.length > 1200 ? description.slice(0, 1197) + "…" : description,
    topLevelGoal: { title: topLevelGoal.title.trim(), description: topLevelGoal.description.trim() },
    agents,
    starterIssues,
  };
}

async function buildManifest(prompt: string, prefs: GeneratorPreferences): Promise<{ manifest: GeneratedCompanyManifest; source: "llm" | "template"; warning: string | null }> {
  const llm = await callNessieProxy({
    // Generator runs before any company exists — surface cost under a synthetic id.
    companyId: "00000000-0000-0000-0000-000000000000",
    messages: [
      {
        role: "system",
        content:
          "You design new companies for Nessie, the AI control plane. Given one paragraph from a founder, design a small 5-person founding team. Output JSON ONLY, no prose, no code fences, in this exact shape:\n{\n  \"companyName\": \"short, real-sounding company name (no LLC/Inc unless natural)\",\n  \"description\": \"1-2 sentences capturing the founder's intent in their own voice\",\n  \"topLevelGoal\": { \"title\": \"<8 words\", \"description\": \"the goal in plain language\" },\n  \"agents\": [\n    { \"slug\": \"ceo\", \"firstName\": \"\", \"lastName\": \"\", \"title\": \"\", \"capabilities\": \"one-sentence description of what this agent owns\" },\n    { \"slug\": \"cto\", ... },\n    { \"slug\": \"eng-founder\", ... },\n    { \"slug\": \"cmo\", ... },\n    { \"slug\": \"designer\", ... }\n  ],\n  \"starterIssues\": [\n    { \"title\": \"\", \"description\": \"2-3 sentences, concrete and specific\", \"assigneeSlug\": \"ceo|cto|eng-founder|cmo|designer\", \"priority\": \"critical|high|medium|low\" }\n  ]\n}\nAlways use exactly those 5 slugs in that order. Pick diverse, plausible human names. Tailor every field to the founder's prompt — generic answers are a failure.",
      },
      { role: "user", content: prompt },
    ],
    temperature: 0.7,
    maxTokens: 1500,
  });

  if (llm.ok) {
    const parsed = coerceManifestFromLlm(prompt, llm.text);
    if (parsed) {
      return { manifest: parsed, source: "llm", warning: null };
    }
    return {
      manifest: buildTemplateManifest(prompt, prefs),
      source: "template",
      warning: "Claude returned an unparseable manifest. Showing the template fallback.",
    };
  }

  return {
    manifest: buildTemplateManifest(prompt, prefs),
    source: "template",
    warning: llm.fix,
  };
}

export function companyGeneratorService(db: Db) {
  const companies = companyService(db);
  const agents = agentService(db);
  const goals = goalService(db);

  return {
    /** Non-destructive preview: returns the manifest without writing anything. */
    async preview(prompt: string, prefs: GeneratorPreferences = {}): Promise<{ manifest: GeneratedCompanyManifest; source: "llm" | "template"; warning: string | null }> {
      return buildManifest(prompt, prefs);
    },

    async generate(
      prompt: string,
      prefs: GeneratorPreferences = {},
      actor?: { actorType: "agent" | "user" | "system"; actorId: string },
    ): Promise<GenerationResult> {
      const { manifest, source, warning } = await buildManifest(prompt, prefs);
      const adapterType = prefs.adapterType ?? "claude_local";
      const autonomyLevel = prefs.autonomyLevel ?? 2;
      const budgetMonthlyCents = prefs.budgetMonthlyCents ?? 0;

      // 1. Company
      const company = await companies.create({
        name: manifest.companyName,
        description: manifest.description,
        budgetMonthlyCents,
      });

      // 2. Departments — idempotent seeder; safe to call even if pre-existing
      // companies share the embedded PG.
      await seedDefaultDepartments(db, company.id);

      // 3. Goal
      const goal = await goals.create(company.id, {
        title: manifest.topLevelGoal.title,
        description: manifest.topLevelGoal.description,
        level: "company",
        status: "active",
        ownerAgentId: null,
        parentId: null,
      });

      // 4. Agents — create executives first so reports-to chains resolve. Map
      // template slugs → real agent ids as we go.
      const slugToId = new Map<string, string>();
      const created: { id: string; slug: string; name: string; title: string }[] = [];
      // Order so any agent's manager has already been created.
      const ordered = [...manifest.agents].sort((a, b) => {
        if (a.reportsToSlug === null && b.reportsToSlug !== null) return -1;
        if (b.reportsToSlug === null && a.reportsToSlug !== null) return 1;
        return 0;
      });
      for (const spec of ordered) {
        const reportsToId = spec.reportsToSlug ? slugToId.get(spec.reportsToSlug) ?? null : null;
        const agent = await agents.create(company.id, {
          name: `${spec.firstName} ${spec.lastName}`,
          humanFirstName: spec.firstName,
          humanLastName: spec.lastName,
          role: spec.role,
          title: spec.title,
          tier: spec.tier,
          reportsTo: reportsToId,
          capabilities: spec.capabilities,
          adapterType,
          adapterConfig: {},
          runtimeConfig: {},
          budgetMonthlyCents: 0,
          spentMonthlyCents: 0,
          autonomyLevel,
          roleTemplateKey: spec.roleTemplateKey,
          status: "idle",
          lastHeartbeatAt: null,
          metadata: { generatedBy: "company-generator", slug: spec.slug },
        });
        if (agent?.id) {
          slugToId.set(spec.slug, agent.id);
          created.push({ id: agent.id, slug: spec.slug, name: agent.name, title: spec.title });
        }
      }

      // 5. Issues — using the raw `issues` table here is a hack to keep the
      // generator from coupling to the full issueService (which has elaborate
      // workspace/checkout semantics that aren't relevant at boot). We add
      // them with status=open and an assignee from the new team. The board
      // can later assign properly via the UI.
      const { issues: issuesTable } = await import("@nessie/db");
      const createdIssues: { id: string; title: string }[] = [];
      // Get the company's issue prefix to mint identifiers.
      const { issuePrefix } = company;
      let counter = company.issueCounter ?? 0;
      for (const spec of manifest.starterIssues) {
        const assigneeId = slugToId.get(spec.assigneeSlug) ?? null;
        counter += 1;
        const identifier = `${issuePrefix}-${counter}`;
        const inserted = await db
          .insert(issuesTable)
          .values({
            companyId: company.id,
            identifier,
            title: spec.title,
            description: spec.description,
            status: "open",
            priority: spec.priority,
            assigneeAgentId: assigneeId,
            goalId: goal?.id ?? null,
          })
          .returning({ id: issuesTable.id, title: issuesTable.title });
        if (inserted[0]) createdIssues.push(inserted[0]);
      }
      // Persist the bumped counter so subsequent issue creation continues correctly.
      if (counter !== (company.issueCounter ?? 0)) {
        const { companies: companiesTable } = await import("@nessie/db");
        const { eq } = await import("drizzle-orm");
        await db
          .update(companiesTable)
          .set({ issueCounter: counter, updatedAt: new Date() })
          .where(eq(companiesTable.id, company.id));
      }

      // 6. Activity log entry — surfaces in the Newsroom ticker as
      // "company.generated".
      await logActivity(db, {
        companyId: company.id,
        actorType: actor?.actorType ?? "user",
        actorId: actor?.actorId ?? "board",
        action: "company.generated",
        entityType: "company",
        entityId: company.id,
        details: {
          agentCount: created.length,
          issueCount: createdIssues.length,
          generator: "template-v1",
          prompt: prompt.slice(0, 280),
        },
      });

      return {
        companyId: company.id,
        companyName: company.name,
        topLevelGoalId: goal?.id ?? null,
        agents: created,
        issues: createdIssues,
        manifest,
        source,
        warning,
      };
    },
  };
}
