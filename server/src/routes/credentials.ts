import { Router, type Request, type Response } from "express";
import { desc, eq, sql } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { credentials, credentialHealth } from "@nessie/db";
import { assertBoardOrgAccess } from "./authz.js";

// Read-only credentials surface for the Quota Watchdog UI. Returns the
// pool with daily-quota state + the most recent health observation per
// credential, so /credentials can render "47/200 today" + a rotated/
// rate_limited chip. Mutations to credentials happen elsewhere
// (settings flows / admin UI).
//
// Credentials are instance-scoped, not company-scoped — we gate on
// board access so only Cockpit users can read the pool.

interface CredentialView {
  id: string;
  tier: string;
  provider: string;
  displayName: string;
  status: string;
  monthlyCapCents: number | null;
  monthlySpentCents: number;
  dailyRequestCap: number | null;
  dailyRequestCount: number;
  dailyResetAt: string | null;
  lastHealthStatus: string | null;
  lastHealthMessage: string | null;
  lastHealthAt: string | null;
}

export function credentialsRoutes(db: Db): Router {
  const router = Router();

  router.get("/credentials", async (req: Request, res: Response) => {
    assertBoardOrgAccess(req);
    const rows = await db
      .select({
        id: credentials.id,
        tier: credentials.tier,
        provider: credentials.provider,
        displayName: credentials.displayName,
        status: credentials.status,
        monthlyCapCents: credentials.monthlyCapCents,
        monthlySpentCents: credentials.monthlySpentCents,
        dailyRequestCap: credentials.dailyRequestCap,
        dailyRequestCount: credentials.dailyRequestCount,
        dailyResetAt: credentials.dailyResetAt,
      })
      .from(credentials)
      .orderBy(credentials.tier, credentials.displayName);

    // Most recent health row per credential. Done with a single
    // distinct-on so we can fold it into the response without N+1.
    const healthRows = await db.execute<{
      credential_id: string;
      status: string;
      message: string | null;
      observed_at: Date;
    }>(sql`
      SELECT DISTINCT ON (credential_id)
        credential_id, status, message, observed_at
      FROM ${credentialHealth}
      ORDER BY credential_id, observed_at DESC
      LIMIT 500
    `);
    const healthByCredential = new Map<string, { status: string; message: string | null; observedAt: Date }>();
    for (const h of healthRows as unknown as Array<{
      credential_id: string;
      status: string;
      message: string | null;
      observed_at: Date;
    }>) {
      healthByCredential.set(h.credential_id, {
        status: h.status,
        message: h.message,
        observedAt: h.observed_at instanceof Date ? h.observed_at : new Date(h.observed_at),
      });
    }

    const view: CredentialView[] = rows.map((r) => {
      const h = healthByCredential.get(r.id) ?? null;
      return {
        id: r.id,
        tier: r.tier,
        provider: r.provider,
        displayName: r.displayName,
        status: r.status,
        monthlyCapCents: r.monthlyCapCents,
        monthlySpentCents: r.monthlySpentCents,
        dailyRequestCap: r.dailyRequestCap,
        dailyRequestCount: r.dailyRequestCount,
        dailyResetAt: r.dailyResetAt ? r.dailyResetAt.toISOString() : null,
        lastHealthStatus: h?.status ?? null,
        lastHealthMessage: h?.message ?? null,
        lastHealthAt: h?.observedAt ? h.observedAt.toISOString() : null,
      };
    });

    res.json({ credentials: view });
  });

  // Recent health observations for one credential (sparkline data).
  router.get("/credentials/:id/health", async (req: Request, res: Response) => {
    assertBoardOrgAccess(req);
    const id = Array.isArray(req.params.id) ? req.params.id[0] : (req.params.id ?? "");
    if (!id) {
      res.status(400).json({ error: "credential id required" });
      return;
    }
    const limitRaw = typeof req.query.limit === "string" ? parseInt(req.query.limit, 10) : NaN;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : 50;
    const rows = await db
      .select()
      .from(credentialHealth)
      .where(eq(credentialHealth.credentialId, id))
      .orderBy(desc(credentialHealth.observedAt))
      .limit(limit);
    res.json({
      observations: rows.map((r) => ({
        id: r.id,
        observedAt: r.observedAt.toISOString(),
        status: r.status,
        message: r.message,
        latencyMs: r.latencyMs,
        http429Count: r.http429Count,
        http5xxCount: r.http5xxCount,
      })),
    });
  });

  return router;
}
