import { Router, type Request, type Response } from "express";
import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { activityLog, replayRuns, arenaRuns } from "@nessie/db";
import { assertCompanyAccess } from "./authz.js";

// "Today's Saves" — counts the wins from the post-Arena features over
// the current UTC day. The Cockpit Dashboard renders these as a small
// KPI row so operators see auto-routes / consensus / replays /
// preflight blocks happening live. Without this surface the free-tier
// story is invisible.

function pickCompanyId(req: Request): string | null {
  const fromHeader = req.header("x-nessie-company-id")?.trim();
  if (fromHeader) return fromHeader;
  const fromQuery = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
  return fromQuery || null;
}

function startOfUtcDay(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

const SAVES_ACTIONS = [
  "heartbeat.preflight_failed",
  "agent.behaviors_updated",
];

interface SavesView {
  windowFrom: string;
  windowTo: string;
  autoRoutedRuns: number;
  consensusRuns: number;
  consensusSpendCents: number;
  replays: number;
  preflightBlocks: number;
  arenaJudged: number;
}

export function savesTodayRoutes(db: Db): Router {
  const router = Router();

  router.get("/saves/today", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    assertCompanyAccess(req, companyId);
    const from = startOfUtcDay();

    // Activity-driven counts (preflight blocks + behaviors changes).
    const actionRows = await db
      .select({ action: activityLog.action, count: sql<string>`count(*)` })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, companyId),
          gte(activityLog.createdAt, from),
          inArray(activityLog.action, SAVES_ACTIONS),
        ),
      )
      .groupBy(activityLog.action);
    const actionCounts = new Map<string, number>();
    for (const r of actionRows) {
      actionCounts.set(r.action, parseInt(r.count, 10) || 0);
    }

    // Replay count + arena judged count (entity tables — more reliable
    // than scraping activity_log since these write rows).
    const [replayCount] = await db
      .select({ c: sql<string>`count(*)` })
      .from(replayRuns)
      .where(and(eq(replayRuns.companyId, companyId), gte(replayRuns.createdAt, from)));

    const [arenaJudgedRow] = await db
      .select({ c: sql<string>`count(*)` })
      .from(arenaRuns)
      .where(
        and(
          eq(arenaRuns.companyId, companyId),
          eq(arenaRuns.status, "judged"),
          gte(arenaRuns.completedAt, from),
        ),
      );

    // Consensus / auto-router: scan heartbeat runs would require a join
    // on resultJson — for v1 we use a sql query that counts activity
    // entries with the new actions. Both publish activity log rows.
    const [autoRoutedRow] = await db
      .select({ c: sql<string>`count(*)` })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, companyId),
          gte(activityLog.createdAt, from),
          sql`details ? 'autoRouterApplied' OR action = 'heartbeat.auto_routed'`,
        ),
      );
    const [consensusRow] = await db
      .select({ c: sql<string>`count(*)`, spendCents: sql<string>`coalesce(sum((details->>'costCents')::int), 0)` })
      .from(activityLog)
      .where(
        and(
          eq(activityLog.companyId, companyId),
          gte(activityLog.createdAt, from),
          sql`details ? 'arenaRunId' OR action = 'heartbeat.consensus_landed'`,
        ),
      );

    const view: SavesView = {
      windowFrom: from.toISOString(),
      windowTo: new Date().toISOString(),
      autoRoutedRuns: parseInt(autoRoutedRow?.c ?? "0", 10) || 0,
      consensusRuns: parseInt(consensusRow?.c ?? "0", 10) || 0,
      consensusSpendCents: parseInt(consensusRow?.spendCents ?? "0", 10) || 0,
      replays: parseInt(replayCount?.c ?? "0", 10) || 0,
      preflightBlocks: actionCounts.get("heartbeat.preflight_failed") ?? 0,
      arenaJudged: parseInt(arenaJudgedRow?.c ?? "0", 10) || 0,
    };
    res.json({ saves: view });
  });

  return router;
}
