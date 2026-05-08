import { Router, type Request, type Response } from "express";
import type { Db } from "@nessie/db";
import { listDepartmentsForCompany, seedDefaultDepartments } from "../services/departments.js";

// Departments REST surface. Mounted at /api.

function pickCompanyId(req: Request): string | null {
  const fromHeader = req.header("x-nessie-company-id")?.trim();
  if (fromHeader) return fromHeader;
  const fromQuery = typeof req.query.companyId === "string" ? req.query.companyId.trim() : "";
  return fromQuery || null;
}

export function departmentRoutes(db: Db): Router {
  const router = Router();

  router.get("/departments", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const rows = await listDepartmentsForCompany(db, companyId);
    res.json({ departments: rows });
  });

  // Idempotent seed of the eight default departments for a company.
  router.post("/departments/seed", async (req: Request, res: Response) => {
    const companyId = pickCompanyId(req);
    if (!companyId) {
      res.status(400).json({ error: "companyId required" });
      return;
    }
    const result = await seedDefaultDepartments(db, companyId);
    res.json(result);
  });

  return router;
}
