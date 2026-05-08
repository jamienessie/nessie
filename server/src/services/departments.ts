import { eq, and } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { departments } from "@nessie/db";

// Departments service.
//
// V1 ships with eight departments: Executive, Product, Engineering, QA,
// Security, HR/Talent, Finance, Policy. Each has a stable key, a Cockpit
// design-token color, a one-line mission, default tier/budget, allowed
// tools, quality standards, and a hiring scorecard template.
//
// seedDefaultDepartments() is idempotent — it inserts only the rows that
// are missing for the given company (matched by `key`). Safe to call on
// every boot.

export interface DepartmentSeed {
  key: string;
  name: string;
  color: string;
  mission: string;
  defaultPreferredTier: "T1" | "T2" | "T3";
  defaultBudgetMonthlyCents: number;
  allowedTools: string[];
  qualityStandards: string[];
  scorecardTemplate: Array<{ criterion: string; weight: number; description?: string }>;
}

// Colors are oklch() literals from the Cockpit design tokens. Match the
// Cockpit `--d-*` CSS variables verbatim so the UI inherits without a
// translation layer.
export const DEFAULT_DEPARTMENTS: readonly DepartmentSeed[] = [
  {
    key: "exec",
    name: "Executive",
    color: "oklch(0.88 0.22 75)", // gold/amber, matches --d-fin-ish exec accent
    mission: "Owns company goals, prioritisation, final escalation, and the operating rhythm.",
    defaultPreferredTier: "T1",
    defaultBudgetMonthlyCents: 5_000,
    allowedTools: ["Read", "Edit", "Bash", "WebFetch"],
    qualityStandards: [
      "Decisions become decision records before they become work.",
      "Every priority change is justified against a company goal.",
    ],
    scorecardTemplate: [
      { criterion: "Strategic clarity", weight: 0.35 },
      { criterion: "Delegation hygiene", weight: 0.25 },
      { criterion: "Cost discipline", weight: 0.20 },
      { criterion: "Communication quality", weight: 0.20 },
    ],
  },
  {
    key: "prod",
    name: "Product",
    color: "oklch(0.84 0.2 200)", // cyan
    mission: "Owns user value, requirements, acceptance criteria, and roadmap clarity.",
    defaultPreferredTier: "T2",
    defaultBudgetMonthlyCents: 3_000,
    allowedTools: ["Read", "Edit", "WebFetch"],
    qualityStandards: [
      "Every spec ships with explicit acceptance criteria.",
      "Personas are named (use Persona Council), not abstracted.",
    ],
    scorecardTemplate: [
      { criterion: "Spec clarity", weight: 0.30 },
      { criterion: "User-value framing", weight: 0.30 },
      { criterion: "Acceptance criteria precision", weight: 0.25 },
      { criterion: "Roadmap honesty", weight: 0.15 },
    ],
  },
  {
    key: "eng",
    name: "Engineering",
    color: "oklch(0.78 0.22 270)", // indigo
    mission: "Ships maintainable code, owns architecture, migrations, and technical plans.",
    defaultPreferredTier: "T2",
    defaultBudgetMonthlyCents: 10_000,
    allowedTools: ["Read", "Edit", "Bash", "Glob", "Grep", "Write"],
    qualityStandards: [
      "No issue closes without evidence (diff link, test pass, log excerpt).",
      "Reviewer approves the diff, not the summary.",
      "Every migration ships with a rollback plan.",
    ],
    scorecardTemplate: [
      { criterion: "Code quality", weight: 0.30 },
      { criterion: "Review pass rate", weight: 0.25 },
      { criterion: "Cost efficiency", weight: 0.20 },
      { criterion: "Speed", weight: 0.15 },
      { criterion: "Collaboration", weight: 0.10 },
    ],
  },
  {
    key: "qa",
    name: "QA",
    color: "oklch(0.82 0.2 195)", // teal
    mission: "Owns tests, reproduction steps, regression checks, and release confidence.",
    defaultPreferredTier: "T2",
    defaultBudgetMonthlyCents: 2_500,
    allowedTools: ["Read", "Edit", "Bash", "Grep"],
    qualityStandards: [
      "Every bug fix lands with a regression test.",
      "Reproduction steps are non-flaky and self-contained.",
    ],
    scorecardTemplate: [
      { criterion: "Test coverage delta", weight: 0.30 },
      { criterion: "Bug-find rate", weight: 0.25 },
      { criterion: "Repro reliability", weight: 0.25 },
      { criterion: "Release confidence", weight: 0.20 },
    ],
  },
  {
    key: "sec",
    name: "Security",
    color: "oklch(0.78 0.27 25)", // crimson
    mission: "Protects secrets, auth, filesystem/network risk, dangerous commands, dependency risk.",
    defaultPreferredTier: "T1",
    defaultBudgetMonthlyCents: 2_000,
    allowedTools: ["Read", "Grep", "Bash"],
    qualityStandards: [
      "No secrets in prompts, ever.",
      "Dangerous shell commands require explicit operator approval.",
      "Every dependency add gets a license + supply-chain review.",
    ],
    scorecardTemplate: [
      { criterion: "Risk-spot accuracy", weight: 0.35 },
      { criterion: "Approval discipline", weight: 0.25 },
      { criterion: "Auditability", weight: 0.20 },
      { criterion: "False-positive rate", weight: 0.20 },
    ],
  },
  {
    key: "hr",
    name: "HR / Talent",
    color: "oklch(0.82 0.24 345)", // pink
    mission: "Hires for outcomes. Runs interviews, trial tasks, scorecards, performance reviews.",
    defaultPreferredTier: "T2",
    defaultBudgetMonthlyCents: 1_500,
    allowedTools: ["Read", "Edit", "WebFetch"],
    qualityStandards: [
      "No hire ships without a scorecard and operator approval.",
      "Trial agents get T3 credentials only — never production.",
    ],
    scorecardTemplate: [
      { criterion: "Hiring quality (90-day reliability)", weight: 0.40 },
      { criterion: "Interview signal", weight: 0.25 },
      { criterion: "Operator-recommendation alignment", weight: 0.20 },
      { criterion: "Onboarding completeness", weight: 0.15 },
    ],
  },
  {
    key: "fin",
    name: "Finance",
    color: "oklch(0.88 0.22 75)", // amber
    mission: "Watches spend, enforces budgets, surfaces subscription pressure, recommends downgrades.",
    defaultPreferredTier: "T2",
    defaultBudgetMonthlyCents: 1_000,
    allowedTools: ["Read", "Grep"],
    qualityStandards: [
      "Daily spend is always visible to the operator.",
      "Cost spikes get a postmortem, not just an alert.",
    ],
    scorecardTemplate: [
      { criterion: "Spend visibility", weight: 0.35 },
      { criterion: "Budget enforcement", weight: 0.25 },
      { criterion: "Routing recommendation quality", weight: 0.25 },
      { criterion: "Forecast accuracy", weight: 0.15 },
    ],
  },
  {
    key: "pol",
    name: "Policy",
    color: "oklch(0.78 0.18 60)", // dark gold
    mission: "Defines and enforces internal boundaries: privacy, TOS, autonomy gates, customer risk.",
    defaultPreferredTier: "T2",
    defaultBudgetMonthlyCents: 1_000,
    allowedTools: ["Read"],
    qualityStandards: [
      "No subscription cookie use without operator opt-in (TOS dial Conservative default).",
      "Trial credits never run sustained production workloads.",
    ],
    scorecardTemplate: [
      { criterion: "Policy clarity", weight: 0.35 },
      { criterion: "Violation catch rate", weight: 0.30 },
      { criterion: "Approval throughput", weight: 0.20 },
      { criterion: "Operator alignment", weight: 0.15 },
    ],
  },
];

// Idempotent seed for one company. Inserts each default department whose
// key is missing for that company; existing rows are left alone.
export async function seedDefaultDepartments(db: Db, companyId: string): Promise<{ inserted: number; existing: number }> {
  let inserted = 0;
  let existing = 0;
  for (const seed of DEFAULT_DEPARTMENTS) {
    const present = await db
      .select({ id: departments.id })
      .from(departments)
      .where(and(eq(departments.companyId, companyId), eq(departments.key, seed.key)))
      .limit(1);
    if (present.length > 0) {
      existing += 1;
      continue;
    }
    await db.insert(departments).values({
      companyId,
      key: seed.key,
      name: seed.name,
      color: seed.color,
      mission: seed.mission,
      defaultPreferredTier: seed.defaultPreferredTier,
      defaultBudgetMonthlyCents: seed.defaultBudgetMonthlyCents,
      allowedTools: seed.allowedTools,
      qualityStandards: seed.qualityStandards,
      scorecardTemplate: seed.scorecardTemplate,
    });
    inserted += 1;
  }
  return { inserted, existing };
}

export async function listDepartmentsForCompany(db: Db, companyId: string) {
  return db.select().from(departments).where(eq(departments.companyId, companyId));
}
