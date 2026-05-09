import { and, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { agents, departments, routines, routineTriggers } from "@nessie/db";
import { findRoleTemplate } from "../onboarding-assets/role-templates.js";
import { logger } from "../middleware/logger.js";

// Idempotent seeding for the Plug-In Janitor (Hank Brennan).
//
// Inserts:
// - One agent row in the Engineering department, role_template_key
//   "eng.plug_in_janitor", adapter gemini_compatible bound to a
//   free-tier Flash model fallback.
// - One routine "Plug-In Janitor sweep" assigned to Hank.
// - One routine_trigger with cron "*/15 * * * *" so the existing
//   routine scheduler picks it up — no new cron infra.
//
// Safe to call on every boot. If the Hank agent already exists for the
// company (matched by role_template_key), the seed is a no-op.

const HANK_TEMPLATE_KEY = "eng.plug_in_janitor";
const SWEEP_CRON = "*/15 * * * *";
const SWEEP_TIMEZONE = "UTC";
const FLASH_FALLBACK_MODEL = "flash-latest";

export async function seedPlugInJanitor(
  db: Db,
  companyId: string,
): Promise<{ created: boolean; agentId: string }> {
  const template = findRoleTemplate(HANK_TEMPLATE_KEY);
  if (!template) {
    throw new Error(`Plug-In Janitor template not found in ROLE_TEMPLATES: ${HANK_TEMPLATE_KEY}`);
  }

  const existing = await db
    .select({ id: agents.id })
    .from(agents)
    .where(and(eq(agents.companyId, companyId), eq(agents.roleTemplateKey, HANK_TEMPLATE_KEY)))
    .limit(1);
  if (existing.length > 0) {
    return { created: false, agentId: existing[0]!.id };
  }

  // Resolve Engineering department (departments are seeded first by
  // seedDefaultDepartments at boot). If absent, the seed cannot proceed —
  // log + return a flag, don't crash the boot.
  const [engDept] = await db
    .select({ id: departments.id })
    .from(departments)
    .where(and(eq(departments.companyId, companyId), eq(departments.key, "eng")))
    .limit(1);
  if (!engDept) {
    logger.warn(
      { companyId },
      "seedPlugInJanitor: Engineering department not found for company; skipping",
    );
    throw new Error("Engineering department not seeded for company");
  }

  const adapterConfig: Record<string, unknown> = {
    model: FLASH_FALLBACK_MODEL,
  };

  const [agentRow] = await db
    .insert(agents)
    .values({
      companyId,
      humanFirstName: template.defaultFirstName,
      humanLastName: template.defaultLastName,
      name: `${template.defaultFirstName} ${template.defaultLastName}`,
      role: "plug_in_janitor",
      title: template.title,
      tier: template.tier,
      departmentId: engDept.id,
      autonomyLevel: template.defaultAutonomyLevel,
      reputationScore: 75,
      roleTemplateKey: template.key,
      status: "idle",
      adapterType: template.defaultAdapterType,
      adapterConfig,
      runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } },
      budgetMonthlyCents: 0,
      spentMonthlyCents: 0,
      permissions: {},
      metadata: { seededBy: "plug_in_janitor_seed", seededAt: new Date().toISOString() },
    })
    .returning();
  if (!agentRow) {
    throw new Error("Failed to insert Plug-In Janitor agent row");
  }

  // Create the sweep routine.
  const [routineRow] = await db
    .insert(routines)
    .values({
      companyId,
      title: "Plug-In Janitor sweep",
      description: "Scans every 15 minutes for broken or out-of-quota agent bindings and swaps to working same-tier replacements. Pauses agents when no replacement is available; escalates whole-adapter outages to engineering.",
      assigneeAgentId: agentRow.id,
      priority: "low",
      status: "active",
      concurrencyPolicy: "coalesce_if_active",
      catchUpPolicy: "skip_missed",
      variables: [],
      createdByAgentId: agentRow.id,
      updatedByAgentId: agentRow.id,
    })
    .returning();
  if (!routineRow) {
    throw new Error("Failed to insert Plug-In Janitor routine");
  }

  await db
    .insert(routineTriggers)
    .values({
      companyId,
      routineId: routineRow.id,
      kind: "schedule",
      label: "Every 15 minutes",
      enabled: true,
      cronExpression: SWEEP_CRON,
      timezone: SWEEP_TIMEZONE,
      createdByAgentId: agentRow.id,
      updatedByAgentId: agentRow.id,
    });

  logger.info({ companyId, agentId: agentRow.id, routineId: routineRow.id }, "Seeded Plug-In Janitor");
  return { created: true, agentId: agentRow.id };
}
