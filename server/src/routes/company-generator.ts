import { Router } from "express";
import { z } from "zod";
import type { Db } from "@nessie/db";
import { validate } from "../middleware/validate.js";
import { assertBoard, getActorInfo } from "./authz.js";
import { companyGeneratorService } from "../services/company-generator.js";

// "Boot a company in 60 seconds" route. One prompt in, full org + starter
// issues out. Currently a templated generator; the service is structured so
// the synthesis step can be swapped for a real LLM call without touching
// this route or the UI.

const generateCompanySchema = z.object({
  prompt: z.string().trim().min(10).max(4000),
  preferences: z
    .object({
      budgetMonthlyCents: z.number().int().nonnegative().optional(),
      autonomyLevel: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]).optional(),
      adapterType: z.string().min(1).max(80).optional(),
    })
    .optional()
    .default({}),
});

const previewCompanySchema = z.object({
  prompt: z.string().trim().min(10).max(4000),
});

export function companyGeneratorRoutes(db: Db) {
  const router = Router();
  const svc = companyGeneratorService(db);

  router.post("/companies/generate/preview", validate(previewCompanySchema), async (req, res) => {
    // Board only — generating preview reveals manifest structure that
    // shouldn't be exposed to agents.
    assertBoard(req);
    const result = await svc.preview(req.body.prompt, {});
    // Backwards-compatible: legacy callers expect the manifest at the top level.
    // The `source` and `warning` keys are added alongside without breaking them.
    res.json({ ...result.manifest, source: result.source, warning: result.warning });
  });

  router.post("/companies/generate", validate(generateCompanySchema), async (req, res) => {
    assertBoard(req);
    const actor = getActorInfo(req);
    const result = await svc.generate(req.body.prompt, req.body.preferences ?? {}, {
      actorType: actor.actorType,
      actorId: actor.actorId,
    });
    res.status(201).json(result);
  });

  return router;
}
