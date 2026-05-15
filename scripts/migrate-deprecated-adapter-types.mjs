#!/usr/bin/env node

// Rewrites agents.adapter_type for adapters that were removed from the Phase 1
// builtin registry. Dry-run by default; pass --apply to write.
//
// Usage:
//   node scripts/migrate-deprecated-adapter-types.mjs            # dry-run, show counts
//   node scripts/migrate-deprecated-adapter-types.mjs --apply    # perform the update
//   node scripts/migrate-deprecated-adapter-types.mjs --json     # machine-readable output

import { argv, env, exit, stderr, stdout } from "node:process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

// `postgres` is a workspace dependency of @nessie/db, not the repo root.
// Resolve it from that package so this script runs without extra installs.
const dbPackageRequire = createRequire(resolve(repoRoot, "packages/db/package.json"));
const postgresEntry = dbPackageRequire.resolve("postgres");
const postgres = (await import(pathToFileURL(postgresEntry).href)).default;

const REPLACEMENTS = {
  acpx_local: "windsurf_local",
  gemini_local: "gemini_compatible",
  cursor: "claude_local",
  pi_local: "openai_compatible",
  openclaw_gateway: "openai_compatible",
};

function parseFlags(args) {
  const flags = new Set(args);
  return { apply: flags.has("--apply"), json: flags.has("--json") };
}

async function loadDatabaseUrl() {
  if (env.DATABASE_URL) return env.DATABASE_URL;
  for (const candidate of [".env", "server/.env"]) {
    try {
      const contents = await readFile(resolve(repoRoot, candidate), "utf8");
      const match = contents.match(/^\s*DATABASE_URL\s*=\s*(.+?)\s*$/m);
      if (match) {
        const value = match[1].replace(/^['"]|['"]$/g, "");
        if (value) return value;
      }
    } catch {
      // file optional
    }
  }
  // Default for Nessie's embedded-postgres dev cluster (config.ts:305).
  return "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";
}

async function main() {
  const { apply, json } = parseFlags(argv.slice(2));
  const databaseUrl = await loadDatabaseUrl();
  if (!databaseUrl) {
    stderr.write("DATABASE_URL not set and not found in .env / server/.env\n");
    exit(2);
  }

  const sql = postgres(databaseUrl);
  try {
    const deprecatedTypes = Object.keys(REPLACEMENTS);
    const rows = await sql`
      SELECT id, name, adapter_type
      FROM agents
      WHERE adapter_type = ANY(${deprecatedTypes})
      ORDER BY adapter_type, name
    `;

    const summary = {};
    for (const row of rows) {
      const target = REPLACEMENTS[row.adapter_type];
      const key = `${row.adapter_type} → ${target}`;
      summary[key] = (summary[key] ?? 0) + 1;
    }

    if (json) {
      stdout.write(
        JSON.stringify(
          {
            mode: apply ? "apply" : "dry-run",
            rowsFound: rows.length,
            byMigration: summary,
            rows: rows.map((r) => ({
              id: r.id,
              name: r.name,
              from: r.adapter_type,
              to: REPLACEMENTS[r.adapter_type],
            })),
          },
          null,
          2,
        ) + "\n",
      );
    } else {
      stdout.write(`Mode: ${apply ? "APPLY" : "dry-run"}\n`);
      stdout.write(`Rows matched: ${rows.length}\n`);
      if (rows.length > 0) {
        stdout.write("\n");
        for (const [migration, count] of Object.entries(summary)) {
          stdout.write(`  ${migration}: ${count}\n`);
        }
        stdout.write("\n");
        for (const row of rows) {
          stdout.write(
            `  - ${row.id}  ${row.name}  (${row.adapter_type} → ${REPLACEMENTS[row.adapter_type]})\n`,
          );
        }
        stdout.write("\n");
      }
    }

    if (!apply) {
      if (!json) stdout.write("Dry-run complete. Re-run with --apply to write changes.\n");
      return;
    }

    if (rows.length === 0) {
      if (!json) stdout.write("No rows to update.\n");
      return;
    }

    let updated = 0;
    for (const [from, to] of Object.entries(REPLACEMENTS)) {
      const result = await sql`
        UPDATE agents
        SET adapter_type = ${to}, updated_at = now()
        WHERE adapter_type = ${from}
      `;
      updated += result.count;
    }
    if (!json) stdout.write(`Applied. ${updated} rows updated.\n`);
    else stdout.write(JSON.stringify({ applied: true, updated }) + "\n");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  stderr.write(`migrate-deprecated-adapter-types failed: ${err?.stack ?? err}\n`);
  exit(1);
});
