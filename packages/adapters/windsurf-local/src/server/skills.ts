import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AdapterExecutionContext,
  AdapterSkillContext,
  AdapterSkillEntry,
  AdapterSkillSnapshot,
} from "@nessie/adapter-utils";
import {
  ensurePaperclipSkillSymlink,
  readPaperclipRuntimeSkillEntries,
  removeMaintainerOnlySkillSymlinks,
  resolvePaperclipDesiredSkillNames,
  type PaperclipSkillEntry,
} from "@nessie/adapter-utils/server-utils";

const __moduleDir = path.dirname(fileURLToPath(import.meta.url));

export function devinSkillsHome(env: NodeJS.ProcessEnv = process.env): string {
  if (process.platform === "win32" && typeof env.APPDATA === "string" && env.APPDATA.trim()) {
    return path.join(env.APPDATA.trim(), "devin", "skills");
  }
  const xdgConfigHome =
    typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim()
      ? env.XDG_CONFIG_HOME.trim()
      : path.join(os.homedir(), ".config");
  return path.join(xdgConfigHome, "devin", "skills");
}

async function selectedSkillEntries(config: Record<string, unknown>): Promise<{
  availableEntries: PaperclipSkillEntry[];
  selectedEntries: PaperclipSkillEntry[];
  desiredSkills: string[];
}> {
  const availableEntries = await readPaperclipRuntimeSkillEntries(config, __moduleDir);
  const desiredSkills = resolvePaperclipDesiredSkillNames(config, availableEntries);
  const desiredSet = new Set(desiredSkills);
  return {
    availableEntries,
    selectedEntries: availableEntries.filter((entry) => desiredSet.has(entry.key)),
    desiredSkills,
  };
}

async function skillTargetState(entry: PaperclipSkillEntry, skillsHome: string): Promise<AdapterSkillEntry["state"]> {
  const target = path.join(skillsHome, entry.runtimeName);
  const existing = await fs.lstat(target).catch(() => null);
  if (!existing) return "configured";
  if (!existing.isSymbolicLink()) return "external";
  const linkedPath = await fs.readlink(target).catch(() => null);
  if (!linkedPath) return "external";
  const resolvedLinkedPath = path.resolve(path.dirname(target), linkedPath);
  return resolvedLinkedPath === path.resolve(entry.source) ? "installed" : "external";
}

async function buildSkillSnapshot(config: Record<string, unknown>): Promise<AdapterSkillSnapshot> {
  const skillsHome = devinSkillsHome();
  const { availableEntries, desiredSkills } = await selectedSkillEntries(config);
  const desiredSet = new Set(desiredSkills);
  const availableByKey = new Map(availableEntries.map((entry) => [entry.key, entry]));
  const warnings: string[] = [];
  const entries: AdapterSkillEntry[] = [];

  for (const entry of availableEntries) {
    const desired = desiredSet.has(entry.key);
    entries.push({
      key: entry.key,
      runtimeName: entry.runtimeName,
      desired,
      managed: true,
      state: desired ? await skillTargetState(entry, skillsHome) : "available",
      origin: entry.required ? "paperclip_required" : "company_managed",
      originLabel: entry.required ? "Required by Paperclip" : "Managed by Paperclip",
      readOnly: false,
      sourcePath: entry.source,
      targetPath: path.join(skillsHome, entry.runtimeName),
      detail: desired
        ? `Will be available to Devin for Terminal from ${skillsHome}.`
        : null,
      required: Boolean(entry.required),
      requiredReason: entry.requiredReason ?? null,
    });
  }

  for (const desiredSkill of desiredSkills) {
    if (availableByKey.has(desiredSkill)) continue;
    warnings.push(`Desired skill "${desiredSkill}" is not available from the Paperclip skills directory.`);
    entries.push({
      key: desiredSkill,
      runtimeName: null,
      desired: true,
      managed: true,
      state: "missing",
      origin: "external_unknown",
      originLabel: "External or unavailable",
      readOnly: false,
      sourcePath: null,
      targetPath: null,
      detail: "Paperclip cannot find this skill in the local runtime skills directory.",
    });
  }

  entries.sort((left, right) => left.key.localeCompare(right.key));
  return {
    adapterType: "windsurf_local",
    supported: true,
    mode: "persistent",
    desiredSkills,
    entries,
    warnings,
  };
}

export async function ensureWindsurfSkillsInjected(input: {
  config: Record<string, unknown>;
  onLog?: AdapterExecutionContext["onLog"];
}) {
  const { availableEntries, selectedEntries } = await selectedSkillEntries(input.config);
  if (availableEntries.length === 0) return;

  const skillsHome = devinSkillsHome();
  await fs.mkdir(skillsHome, { recursive: true });
  const selectedRuntimeNames = selectedEntries.map((entry) => entry.runtimeName);
  const removedSkills = await removeMaintainerOnlySkillSymlinks(skillsHome, selectedRuntimeNames);
  for (const skillName of removedSkills) {
    await input.onLog?.(
      "stderr",
      `[paperclip] Removed maintainer-only Windsurf skill "${skillName}" from ${skillsHome}\n`,
    );
  }

  for (const entry of selectedEntries) {
    const target = path.join(skillsHome, entry.runtimeName);
    try {
      const result = await ensurePaperclipSkillSymlink(entry.source, target);
      if (result === "skipped") continue;
      await input.onLog?.(
        "stderr",
        `[paperclip] ${result === "repaired" ? "Repaired" : "Injected"} Windsurf skill "${entry.key}" into ${skillsHome}\n`,
      );
    } catch (err) {
      await input.onLog?.(
        "stderr",
        `[paperclip] Failed to inject Windsurf skill "${entry.key}" into ${skillsHome}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}

export async function listWindsurfSkills(ctx: AdapterSkillContext): Promise<AdapterSkillSnapshot> {
  return buildSkillSnapshot(ctx.config);
}

export async function syncWindsurfSkills(
  ctx: AdapterSkillContext,
  _desiredSkills: string[],
): Promise<AdapterSkillSnapshot> {
  await ensureWindsurfSkillsInjected({ config: ctx.config });
  return buildSkillSnapshot(ctx.config);
}
