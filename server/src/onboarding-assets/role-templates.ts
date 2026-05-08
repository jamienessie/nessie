// Nessie ships with a curated set of role templates. Each template provides:
//   - a stable key (used for agents.roleTemplateKey)
//   - a default human-style name the operator can edit during onboarding
//   - a job title that appears next to the name across the UI
//   - a default cost tier (T1/T2/T3)
//   - a department key (matches departments.key)
//
// **The display rule: every agent must show "<Name> · <Title>" — never one
// without the other, never a bare ID.** See plan Section 3.
//
// Default names are diverse, professional, plausible. The operator is
// expected to overwrite whatever doesn't fit; the wizard validates that
// neither field is empty before submit. Renaming post-hire is supported.

export type RoleTemplateTier = "T1" | "T2" | "T3";
export type RoleTemplateDepartmentKey =
  | "exec"
  | "prod"
  | "eng"
  | "qa"
  | "sec"
  | "hr"
  | "fin"
  | "pol"
  | "ops";

export interface RoleTemplate {
  key: string;
  defaultFirstName: string;
  defaultLastName: string;
  title: string;
  tier: RoleTemplateTier;
  departmentKey: RoleTemplateDepartmentKey;
  defaultAdapterType: string;
  defaultAutonomyLevel: number;
  /**
   * Short pitch shown in the hire wizard. Two sentences: what the role
   * owns, and why this template defaults to its tier.
   */
  pitch: string;
}

export const ROLE_TEMPLATES: readonly RoleTemplate[] = [
  // Executive
  {
    key: "exec.ceo",
    defaultFirstName: "Aria",
    defaultLastName: "Whitfield",
    title: "CEO",
    tier: "T1",
    departmentKey: "exec",
    defaultAdapterType: "claude_local",
    defaultAutonomyLevel: 2,
    pitch: "Holds the company's mission and prioritises across departments. T1 because every CEO call is judgment work.",
  },
  {
    key: "exec.cto",
    defaultFirstName: "Marcus",
    defaultLastName: "Chen",
    title: "CTO",
    tier: "T1",
    departmentKey: "exec",
    defaultAdapterType: "claude_local",
    defaultAutonomyLevel: 2,
    pitch: "Owns architecture and delegates code work to Engineering. T1 — the wrong tech-debt call is expensive.",
  },
  {
    key: "exec.cmo",
    defaultFirstName: "Naomi",
    defaultLastName: "Okafor",
    title: "CMO",
    tier: "T1",
    departmentKey: "exec",
    defaultAdapterType: "claude_local",
    defaultAutonomyLevel: 2,
    pitch: "Owns positioning, narrative, and growth. T1 because brand judgment doesn't downgrade well.",
  },
  {
    key: "exec.cfo",
    defaultFirstName: "Theo",
    defaultLastName: "Rashid",
    title: "CFO",
    tier: "T1",
    departmentKey: "exec",
    defaultAdapterType: "claude_local",
    defaultAutonomyLevel: 2,
    pitch: "Owns spend visibility, budgets, and provider sustainability. T1 because money mistakes compound silently.",
  },

  // HR / Talent
  {
    key: "hr.head",
    defaultFirstName: "Lena",
    defaultLastName: "Park",
    title: "Head of HR",
    tier: "T1",
    departmentKey: "hr",
    defaultAdapterType: "claude_local",
    defaultAutonomyLevel: 2,
    pitch: "Owns hiring policy, scorecards, and final hire recommendations to the operator.",
  },
  {
    key: "hr.recruiter",
    defaultFirstName: "Daniela",
    defaultLastName: "Costa",
    title: "Recruiter",
    tier: "T3",
    departmentKey: "hr",
    defaultAdapterType: "openai_compatible",
    defaultAutonomyLevel: 1,
    pitch: "Sources candidates from templates, adapters, and existing employees. T3 — high volume, low stakes.",
  },

  // Security / Policy / Ops
  {
    key: "sec.head",
    defaultFirstName: "Dmitri",
    defaultLastName: "Volkov",
    title: "Head of Security",
    tier: "T1",
    departmentKey: "sec",
    defaultAdapterType: "claude_local",
    defaultAutonomyLevel: 2,
    pitch: "Owns secrets, auth, dependency risk, dangerous-command review. Operator's veto on anything risky.",
  },
  {
    key: "pol.officer",
    defaultFirstName: "Yuki",
    defaultLastName: "Tanaka",
    title: "Policy Officer",
    tier: "T2",
    departmentKey: "pol",
    defaultAdapterType: "openai_compatible",
    defaultAutonomyLevel: 2,
    pitch: "Enforces internal boundaries: secrets exposure, trial-credit usage, sensitive-file access.",
  },
  {
    key: "ops.head",
    defaultFirstName: "Idris",
    defaultLastName: "Ahmadi",
    title: "Head of Ops",
    tier: "T2",
    departmentKey: "ops",
    defaultAdapterType: "openai_compatible",
    defaultAutonomyLevel: 2,
    pitch: "Operating rhythm, rituals, runbooks, and follow-through on action items.",
  },

  // Engineering
  {
    key: "eng.lead",
    defaultFirstName: "Sofia",
    defaultLastName: "Reyes",
    title: "Engineering Lead",
    tier: "T1",
    departmentKey: "eng",
    defaultAdapterType: "claude_local",
    defaultAutonomyLevel: 3,
    pitch: "Owns architecture proposals and technical plans; delegates implementation to ICs.",
  },
  {
    key: "eng.ic",
    defaultFirstName: "Jules",
    defaultLastName: "Bernard",
    title: "Software Engineer",
    tier: "T3",
    departmentKey: "eng",
    defaultAdapterType: "openai_compatible",
    defaultAutonomyLevel: 1,
    pitch: "Implements work under a Reviewer's eye. T3 because bulk code changes belong on the cheap tier.",
  },
  {
    key: "eng.reviewer",
    defaultFirstName: "Owen",
    defaultLastName: "Mackenzie",
    title: "Senior Reviewer",
    tier: "T1",
    departmentKey: "eng",
    defaultAdapterType: "claude_local",
    defaultAutonomyLevel: 2,
    pitch: "Approves IC work against acceptance criteria. T1 because review is judgment, not generation.",
  },

  // QA
  {
    key: "qa.lead",
    defaultFirstName: "Priya",
    defaultLastName: "Iyer",
    title: "QA Lead",
    tier: "T2",
    departmentKey: "qa",
    defaultAdapterType: "claude_local",
    defaultAutonomyLevel: 2,
    pitch: "Owns release confidence, regression checks, reproduction steps for failures.",
  },
  {
    key: "qa.ic",
    defaultFirstName: "Chen",
    defaultLastName: "Wei",
    title: "QA Engineer",
    tier: "T3",
    departmentKey: "qa",
    defaultAdapterType: "openai_compatible",
    defaultAutonomyLevel: 1,
    pitch: "Writes and runs tests, files reproduction issues. T3 — the work is high-volume and structured.",
  },

  // Product
  {
    key: "prod.pm",
    defaultFirstName: "Maya",
    defaultLastName: "Lindqvist",
    title: "Product Manager",
    tier: "T2",
    departmentKey: "prod",
    defaultAdapterType: "openai_compatible",
    defaultAutonomyLevel: 2,
    pitch: "Owns user value, requirements, acceptance criteria, roadmap clarity.",
  },
  {
    key: "prod.designer",
    defaultFirstName: "Felix",
    defaultLastName: "Romano",
    title: "Product Designer",
    tier: "T2",
    departmentKey: "prod",
    defaultAdapterType: "openai_compatible",
    defaultAutonomyLevel: 2,
    pitch: "Owns visual coherence, copy, flow ergonomics. Pairs with PM on every spec.",
  },
];

export function findRoleTemplate(key: string): RoleTemplate | undefined {
  return ROLE_TEMPLATES.find((t) => t.key === key);
}

export function listRoleTemplates(): readonly RoleTemplate[] {
  return ROLE_TEMPLATES;
}
