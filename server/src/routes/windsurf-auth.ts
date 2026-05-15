/**
 * In-app manual sign-in flow for the windsurf_local adapter.
 *
 * Drives `devin auth login --force-manual-token-flow` as a child process so
 * the operator can complete Windsurf's manual OTT exchange without leaving
 * the Nessie UI. On success: Devin's local auth cache is populated AND the
 * token is mirrored into a company secret bound to env.WINDSURF_API_KEY by
 * the caller.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Router } from "express";
import type { Db } from "@nessie/db";
import { z } from "zod";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { validate } from "../middleware/validate.js";
import { secretService } from "../services/secrets.js";
import { logger } from "../middleware/logger.js";

const SESSION_TTL_MS = 5 * 60 * 1_000;
const URL_DETECT_TIMEOUT_MS = 10 * 1_000;
const COMPLETE_EXIT_TIMEOUT_MS = 30 * 1_000;
const SECRET_NAME = "windsurf-api-key";
const URL_REGEX = /https?:\/\/[^\s'"<>]+/;

type Session = {
  child: ChildProcessWithoutNullStreams;
  companyId: string;
  signinUrl: string;
  expiryTimer: NodeJS.Timeout;
  stdoutBuffer: string;
  stderrBuffer: string;
};

const sessions = new Map<string, Session>();

function killAndEvict(sessionId: string, reason: string) {
  const session = sessions.get(sessionId);
  if (!session) return;
  clearTimeout(session.expiryTimer);
  sessions.delete(sessionId);
  if (!session.child.killed) {
    try {
      session.child.kill();
    } catch (err) {
      logger.warn(
        { sessionId, reason, err: err instanceof Error ? err.message : String(err) },
        "windsurf-auth: failed to kill child",
      );
    }
  }
}

function truncateForUi(text: string, max = 600): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

const startSchema = z.object({ companyId: z.string().min(1) });
const completeSchema = z.object({
  sessionId: z.string().min(1),
  token: z.string().min(1),
  companyId: z.string().min(1),
  bindEnv: z.boolean().optional(),
});

export function windsurfAuthRoutes(db: Db) {
  const router = Router();
  const secrets = secretService(db);

  router.post(
    "/adapters/windsurf/signin/start",
    validate(startSchema),
    async (req, res) => {
      assertBoard(req);
      const { companyId } = req.body as z.infer<typeof startSchema>;
      assertCompanyAccess(req, companyId);

      // Evict any prior session for this company — the operator just kicked
      // off a new flow, so the old one is stale.
      for (const [sid, sess] of sessions) {
        if (sess.companyId === companyId) {
          killAndEvict(sid, "replaced_by_new_start");
        }
      }

      let child: ChildProcessWithoutNullStreams;
      try {
        child = spawn("devin", ["auth", "login", "--force-manual-token-flow"]);
      } catch (err) {
        logger.warn(
          { err: err instanceof Error ? err.message : String(err) },
          "windsurf-auth: failed to spawn devin",
        );
        res.status(412).json({
          error: "Devin CLI not installed or not on PATH.",
          hint: "Install Devin for Terminal (https://docs.devin.ai/cli) and ensure `devin` is on PATH.",
        });
        return;
      }

      const sessionId = randomUUID();
      const session: Session = {
        child,
        companyId,
        signinUrl: "",
        stdoutBuffer: "",
        stderrBuffer: "",
        expiryTimer: setTimeout(() => killAndEvict(sessionId, "ttl_expired"), SESSION_TTL_MS),
      };
      sessions.set(sessionId, session);

      child.stdout.setEncoding("utf-8");
      child.stderr.setEncoding("utf-8");
      child.stdout.on("data", (chunk: string) => {
        session.stdoutBuffer += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        session.stderrBuffer += chunk;
      });

      // ENOENT manifests asynchronously on Linux/Mac via 'error' event.
      let earlyError: Error | null = null;
      child.once("error", (err) => {
        earlyError = err;
      });

      const detectedAt = Date.now();
      let signinUrl = "";
      while (Date.now() - detectedAt < URL_DETECT_TIMEOUT_MS) {
        if (earlyError) {
          killAndEvict(sessionId, "spawn_error");
          const message =
            (earlyError as NodeJS.ErrnoException).code === "ENOENT"
              ? "Devin CLI not installed or not on PATH."
              : (earlyError as Error).message;
          res.status(412).json({ error: message });
          return;
        }
        if (child.exitCode !== null) {
          killAndEvict(sessionId, "exited_before_url");
          res.status(502).json({
            error: "Devin exited before producing a sign-in URL.",
            stdout: truncateForUi(session.stdoutBuffer),
            stderr: truncateForUi(session.stderrBuffer),
          });
          return;
        }
        const match = session.stdoutBuffer.match(URL_REGEX) ?? session.stderrBuffer.match(URL_REGEX);
        if (match) {
          signinUrl = match[0];
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      if (!signinUrl) {
        killAndEvict(sessionId, "url_timeout");
        res.status(504).json({
          error: "Devin did not emit a sign-in URL within 10 seconds.",
          stdout: truncateForUi(session.stdoutBuffer),
          stderr: truncateForUi(session.stderrBuffer),
        });
        return;
      }

      session.signinUrl = signinUrl;
      res.status(200).json({ sessionId, signinUrl });
    },
  );

  router.post(
    "/adapters/windsurf/signin/complete",
    validate(completeSchema),
    async (req, res) => {
      assertBoard(req);
      const { sessionId, token, companyId, bindEnv } =
        req.body as z.infer<typeof completeSchema>;
      assertCompanyAccess(req, companyId);

      const session = sessions.get(sessionId);
      if (!session) {
        res.status(404).json({ error: "Sign-in session not found or expired. Start over." });
        return;
      }
      if (session.companyId !== companyId) {
        res.status(403).json({ error: "Session does not belong to this company." });
        return;
      }

      const exitPromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
        (resolve) => {
          session.child.once("exit", (code, signal) => resolve({ code, signal }));
        },
      );

      try {
        session.child.stdin.write(`${token}\n`);
        session.child.stdin.end();
      } catch (err) {
        killAndEvict(sessionId, "stdin_write_failed");
        res.status(500).json({
          error: "Failed to send token to Devin.",
          detail: err instanceof Error ? err.message : String(err),
        });
        return;
      }

      const timeoutPromise = new Promise<{ timedOut: true }>((resolve) =>
        setTimeout(() => resolve({ timedOut: true }), COMPLETE_EXIT_TIMEOUT_MS),
      );

      const result = await Promise.race([exitPromise, timeoutPromise]);

      if ("timedOut" in result) {
        killAndEvict(sessionId, "complete_exit_timeout");
        res.status(504).json({
          error: "Devin did not finish the login within 30 seconds.",
          stdout: truncateForUi(session.stdoutBuffer),
          stderr: truncateForUi(session.stderrBuffer),
        });
        return;
      }

      clearTimeout(session.expiryTimer);
      sessions.delete(sessionId);

      if (result.code !== 0) {
        res.status(400).json({
          error: "Devin rejected the token.",
          exitCode: result.code,
          signal: result.signal,
          stdout: truncateForUi(session.stdoutBuffer),
          stderr: truncateForUi(session.stderrBuffer),
        });
        return;
      }

      let secretId: string | null = null;
      let secretName: string | null = null;
      if (bindEnv) {
        try {
          const existing = await secrets.getByName(companyId, SECRET_NAME);
          if (existing) {
            const rotated = await secrets.rotate(
              existing.id,
              { value: token },
              { userId: req.actor.userId ?? "board", agentId: null },
            );
            secretId = rotated.id;
            secretName = rotated.name;
          } else {
            const created = await secrets.create(
              companyId,
              {
                name: SECRET_NAME,
                provider: "local_encrypted",
                value: token,
                description: "Auto-stored Windsurf OTT token via in-app manual sign-in",
              },
              { userId: req.actor.userId ?? "board", agentId: null },
            );
            secretId = created.id;
            secretName = created.name;
          }
        } catch (err) {
          logger.warn(
            { err: err instanceof Error ? err.message : String(err) },
            "windsurf-auth: secret persistence failed (Devin login still succeeded)",
          );
          res.status(200).json({
            ok: true,
            devinAuthed: true,
            secretId: null,
            secretName: null,
            secretError: err instanceof Error ? err.message : String(err),
          });
          return;
        }
      }

      res.status(200).json({
        ok: true,
        devinAuthed: true,
        secretId,
        secretName,
      });
    },
  );

  return router;
}
