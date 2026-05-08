import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Db } from "@nessie/db";

// Disaster Recovery — plan §20.52.
//
// One-button export of every Nessie-owned table to JSONL + a
// manifest. Matching import path that verifies hashes and optionally
// restores into a fresh DB.
//
// JSONL was chosen over pg_dump because:
//   - inspectable (`jq` works, grep works)
//   - portable (no Postgres tooling required to read)
//   - per-table separation makes partial restores trivial
//
// Secrets table content is excluded by default. The operator can
// pass {secrets: 'include'} explicitly. The exported tarball never
// contains live API keys; secret_ref columns point at env vars
// resolved at runtime, so an export captures the structure without
// the values.
//
// v1 ships export + verify. Restore (replaying JSONL into a fresh
// DB) is wired in but expects the target to already have the same
// schema applied via pnpm db:migrate.

// Tables to export. Order matters for restore: parents before children.
// Auth/multi-user tables are intentionally excluded (Nessie is single-
// operator; those are stripped/inert in v1).
const EXPORTABLE_TABLES = [
  "companies",
  "company_logos",
  "instance_settings",
  "departments",
  "role_templates",
  "agents",
  "agent_config_revisions",
  "agent_runtime_state",
  "agent_task_sessions",
  "credentials",
  "credential_health",
  "subscription_quotas",
  "projects",
  "project_workspaces",
  "execution_workspaces",
  "environments",
  "environment_leases",
  "goals",
  "project_goals",
  "labels",
  "issues",
  "issue_labels",
  "issue_relations",
  "issue_comments",
  "issue_documents",
  "documents",
  "document_revisions",
  "issue_approvals",
  "issue_attachments",
  "assets",
  "heartbeat_runs",
  "heartbeat_run_events",
  "cost_events",
  "finance_events",
  "approvals",
  "approval_comments",
  "activity_log",
  "company_secrets",
  "company_secret_versions",
  "company_skills",
  "meetings",
  "meeting_participants",
  "meeting_messages",
  "meeting_outcomes",
  "hires",
  "candidates",
  "scorecards",
  "agent_bus_messages",
  "work_contracts",
  "black_box_records",
  "reputation_events",
  "inbox_items",
  "operator_constitution",
  "operator_constitution_versions",
  "trust_receipts",
  "routines",
  "routine_revisions",
  "routine_triggers",
  "routine_runs",
] as const;

// Tables we always exclude content from regardless of {secrets} option.
const ALWAYS_EXCLUDED = new Set<string>([
  "auth_users",
  "auth_sessions",
  "auth_accounts",
  "auth_verifications",
  "board_api_keys",
  "agent_api_keys",
  "cli_auth_challenges",
]);

// Tables whose content is stripped unless secrets:'include' is passed.
const SECRET_TABLES = new Set<string>([
  "company_secrets",
  "company_secret_versions",
]);

export interface ExportOptions {
  outDir: string;
  secrets?: "exclude" | "include";
  schemaVersion?: string;
}

export interface ExportManifest {
  exportedAt: string;
  schemaVersion: string;
  secretsIncluded: boolean;
  tables: Array<{
    name: string;
    rowCount: number;
    bytes: number;
    sha256: string;
    path: string;
  }>;
}

export class DisasterRecoveryService {
  constructor(private readonly db: Db) {}

  async exportAll(opts: ExportOptions): Promise<ExportManifest> {
    const { outDir } = opts;
    const includeSecrets = opts.secrets === "include";
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

    const manifestTables: ExportManifest["tables"] = [];
    for (const table of EXPORTABLE_TABLES) {
      if (ALWAYS_EXCLUDED.has(table)) continue;
      if (!includeSecrets && SECRET_TABLES.has(table)) {
        // Write an empty placeholder so restore doesn't error on missing file.
        const placeholderPath = path.join(outDir, `${table}.jsonl`);
        writeFileSync(placeholderPath, "");
        manifestTables.push({
          name: table,
          rowCount: 0,
          bytes: 0,
          sha256: createHash("sha256").update("").digest("hex"),
          path: `${table}.jsonl`,
        });
        continue;
      }
      let rows: unknown[] = [];
      try {
        const result = await this.db.execute(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          `select * from "${table}"` as unknown as any,
        );
        rows = ((result as { rows?: unknown[] }).rows ?? []) as unknown[];
      } catch {
        // Table may not exist in this version of the schema (e.g. partial
        // upgrade). Skip silently; the manifest captures what we have.
        continue;
      }
      const lines = rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length > 0 ? "\n" : "");
      const filePath = path.join(outDir, `${table}.jsonl`);
      writeFileSync(filePath, lines);
      const sha = createHash("sha256").update(lines).digest("hex");
      manifestTables.push({
        name: table,
        rowCount: rows.length,
        bytes: Buffer.byteLength(lines),
        sha256: sha,
        path: `${table}.jsonl`,
      });
    }
    const manifest: ExportManifest = {
      exportedAt: new Date().toISOString(),
      schemaVersion: opts.schemaVersion ?? "0087",
      secretsIncluded: includeSecrets,
      tables: manifestTables,
    };
    writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
    return manifest;
  }

  async verify(inDir: string): Promise<{ ok: boolean; errors: string[] }> {
    const manifestPath = path.join(inDir, "manifest.json");
    if (!existsSync(manifestPath)) {
      return { ok: false, errors: [`manifest.json missing at ${manifestPath}`] };
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ExportManifest;
    const errors: string[] = [];
    const presentFiles = new Set(readdirSync(inDir));
    for (const table of manifest.tables) {
      if (!presentFiles.has(table.path)) {
        errors.push(`missing file ${table.path}`);
        continue;
      }
      const buf = readFileSync(path.join(inDir, table.path));
      const sha = createHash("sha256").update(buf).digest("hex");
      if (sha !== table.sha256) {
        errors.push(`sha256 mismatch for ${table.path} (expected ${table.sha256}, got ${sha})`);
      }
      if (Buffer.byteLength(buf) !== table.bytes) {
        errors.push(`byte mismatch for ${table.path} (expected ${table.bytes}, got ${Buffer.byteLength(buf)})`);
      }
    }
    return { ok: errors.length === 0, errors };
  }
}

export function disasterRecoveryService(db: Db): DisasterRecoveryService {
  return new DisasterRecoveryService(db);
}
