import { and, desc, eq, sql } from "drizzle-orm";
import type { Db } from "@nessie/db";
import {
  hires,
  candidates,
  scorecards,
  roleTemplates,
  agents,
  departments,
} from "@nessie/db";
import { ROLE_TEMPLATES } from "../onboarding-assets/role-templates.js";
import { blackBoxRecorder } from "./black-box.js";
import { sendFromOperator } from "./agent-bus-helpers.js";

// HR pipeline service.
//
// Owns the hire lifecycle, candidate roster, scoring, and the hard rule:
// trial agents only ever run on T3 credentials. The mintHiredAgent()
// path is the only place where a candidate can be promoted into a real
// agents row, and even there the operator approval is required upstream
// (route layer).

export const HIRE_STATES = [
  "open",
  "sourcing",
  "interviewing",
  "trial",
  "recommended",
  "hired",
  "rejected",
] as const;
export type HireState = (typeof HIRE_STATES)[number];

const HIRE_TRANSITIONS: Record<HireState, ReadonlySet<HireState>> = {
  open: new Set(["sourcing", "rejected"]),
  sourcing: new Set(["interviewing", "rejected"]),
  interviewing: new Set(["trial", "recommended", "rejected"]),
  trial: new Set(["recommended", "rejected"]),
  recommended: new Set(["hired", "rejected"]),
  hired: new Set(),
  rejected: new Set(),
};

export function canHireTransition(from: HireState, to: HireState): boolean {
  return HIRE_TRANSITIONS[from].has(to);
}

export const CANDIDATE_STATES = [
  "proposed",
  "interviewing",
  "trial",
  "recommended",
  "offered",
  "accepted",
  "declined",
  "rejected",
] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

export class HiresService {
  constructor(private readonly db: Db) {}

  // -------------------------------------------------------------------
  // Role templates: catalog (DB row mirror of the static seed)
  // -------------------------------------------------------------------

  // Idempotent: insert any rows whose key isn't yet in the table, and
  // resolve each row's department_id from departments(company,key).
  async seedRoleTemplates(companyId: string): Promise<{ inserted: number; existing: number }> {
    let inserted = 0;
    let existing = 0;
    const departmentRows = await this.db
      .select({ id: departments.id, key: departments.key })
      .from(departments)
      .where(eq(departments.companyId, companyId));
    const departmentByKey = new Map(departmentRows.map((d) => [d.key, d.id]));

    for (const tmpl of ROLE_TEMPLATES) {
      const present = await this.db
        .select({ id: roleTemplates.id })
        .from(roleTemplates)
        .where(eq(roleTemplates.key, tmpl.key))
        .limit(1);
      if (present.length > 0) {
        existing += 1;
        continue;
      }
      await this.db.insert(roleTemplates).values({
        key: tmpl.key,
        defaultFirstName: tmpl.defaultFirstName,
        defaultLastName: tmpl.defaultLastName,
        title: tmpl.title,
        tier: tmpl.tier,
        departmentKey: tmpl.departmentKey,
        departmentId: departmentByKey.get(tmpl.departmentKey) ?? null,
        defaultAdapterType: tmpl.defaultAdapterType,
        defaultAutonomyLevel: tmpl.defaultAutonomyLevel,
        pitch: tmpl.pitch,
      });
      inserted += 1;
    }
    return { inserted, existing };
  }

  async listRoleTemplates() {
    return this.db.select().from(roleTemplates).orderBy(roleTemplates.key);
  }

  // -------------------------------------------------------------------
  // Hires
  // -------------------------------------------------------------------

  async listHires(companyId: string, opts?: { status?: HireState }) {
    const conditions = [eq(hires.companyId, companyId)];
    if (opts?.status) conditions.push(eq(hires.status, opts.status));
    return this.db
      .select()
      .from(hires)
      .where(and(...conditions))
      .orderBy(desc(hires.updatedAt));
  }

  async getHire(companyId: string, hireId: string) {
    const rows = await this.db
      .select()
      .from(hires)
      .where(and(eq(hires.companyId, companyId), eq(hires.id, hireId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async createHire(input: {
    companyId: string;
    title: string;
    description?: string | null;
    requestedRoleTemplateKey?: string | null;
    requestedDepartmentId?: string | null;
    requestedTier?: "T1" | "T2" | "T3";
    packet?: Record<string, unknown>;
    createdByAgentId?: string | null;
    createdByUserId?: string | null;
  }) {
    const [created] = await this.db
      .insert(hires)
      .values({
        companyId: input.companyId,
        title: input.title,
        description: input.description ?? null,
        requestedRoleTemplateKey: input.requestedRoleTemplateKey ?? null,
        requestedDepartmentId: input.requestedDepartmentId ?? null,
        requestedTier: input.requestedTier ?? "T2",
        packet: input.packet ?? {},
        createdByAgentId: input.createdByAgentId ?? null,
        createdByUserId: input.createdByUserId ?? null,
        status: "open",
      })
      .returning();
    return created;
  }

  async transitionHire(companyId: string, hireId: string, to: HireState) {
    const hire = await this.getHire(companyId, hireId);
    if (!hire) throw new Error(`Hire ${hireId} not found`);
    const from = hire.status as HireState;
    if (!canHireTransition(from, to)) {
      throw new Error(`Illegal hire transition: ${from} -> ${to}`);
    }
    const [updated] = await this.db
      .update(hires)
      .set({ status: to, updatedAt: new Date() })
      .where(and(eq(hires.companyId, companyId), eq(hires.id, hireId)))
      .returning();
    if (to === "recommended") {
      await sendFromOperator(this.db, companyId, {
        kind: "hiring_request",
        payload: { hireId, fromState: from, title: hire.title },
      }).catch((err) => {
        console.warn(`[hires] hiring_request bus enqueue failed for ${hireId}:`, err);
      });
    }
    return updated;
  }

  // -------------------------------------------------------------------
  // Candidates
  // -------------------------------------------------------------------

  async listCandidates(hireId: string) {
    return this.db
      .select()
      .from(candidates)
      .where(eq(candidates.hireId, hireId))
      .orderBy(desc(candidates.updatedAt));
  }

  async addCandidate(input: {
    hireId: string;
    humanFirstName: string;
    humanLastName: string;
    title: string;
    summary?: string | null;
    resumeMarkdown?: string | null;
    sourceTemplateKey?: string | null;
    proposedAdapterType?: string | null;
  }) {
    const [created] = await this.db
      .insert(candidates)
      .values({
        hireId: input.hireId,
        humanFirstName: input.humanFirstName.trim(),
        humanLastName: input.humanLastName.trim(),
        title: input.title.trim(),
        summary: input.summary ?? null,
        resumeMarkdown: input.resumeMarkdown ?? null,
        sourceTemplateKey: input.sourceTemplateKey ?? null,
        proposedAdapterType: input.proposedAdapterType ?? null,
        status: "proposed",
      })
      .returning();
    return created;
  }

  async setCandidateStatus(candidateId: string, to: CandidateState) {
    const [updated] = await this.db
      .update(candidates)
      .set({ status: to, updatedAt: new Date() })
      .where(eq(candidates.id, candidateId))
      .returning();
    return updated;
  }

  async setTrialIssue(candidateId: string, trialIssueId: string) {
    const [updated] = await this.db
      .update(candidates)
      .set({ trialIssueId, status: "trial", updatedAt: new Date() })
      .where(eq(candidates.id, candidateId))
      .returning();
    return updated;
  }

  // -------------------------------------------------------------------
  // Scorecards
  // -------------------------------------------------------------------

  async listScorecards(candidateId: string) {
    return this.db
      .select()
      .from(scorecards)
      .where(eq(scorecards.candidateId, candidateId))
      .orderBy(desc(scorecards.scoredAt));
  }

  async addScorecard(input: {
    candidateId: string;
    pass: "interview" | "trial" | "final";
    rubric: Array<{ criterion: string; weight: number; score: number; note?: string }>;
    recommendation?: "strong_hire" | "hire" | "weak_hire" | "no_hire" | "strong_no_hire";
    notes?: string | null;
    scoredByAgentId?: string | null;
    scoredByUserId?: string | null;
  }) {
    const totalScore = input.rubric.reduce(
      (acc, row) => acc + (row.weight ?? 0) * (row.score ?? 0),
      0,
    );
    const [created] = await this.db
      .insert(scorecards)
      .values({
        candidateId: input.candidateId,
        pass: input.pass,
        rubric: input.rubric,
        totalScore: totalScore.toFixed(2),
        recommendation: input.recommendation ?? (totalScore >= 4 ? "strong_hire" : totalScore >= 3 ? "hire" : totalScore >= 2 ? "weak_hire" : "no_hire"),
        notes: input.notes ?? null,
        scoredByAgentId: input.scoredByAgentId ?? null,
        scoredByUserId: input.scoredByUserId ?? null,
        starsHelper: Math.round(totalScore),
      })
      .returning();
    return created;
  }

  // -------------------------------------------------------------------
  // Hire decision
  // -------------------------------------------------------------------

  // Mint a real agent row from an accepted candidate. Operator-approved
  // upstream (route layer); this just performs the DB write atomically.
  // The hard rule lives on the route layer too: a candidate's tier
  // chosen by the operator is whatever the role template / hire
  // requested it to be — but until the agent is fully `hired`, every
  // earlier-stage credential interaction must remain T3 (trial). This
  // service refuses to set candidates.agentId unless the hire status
  // has already moved to 'recommended' or 'hired'.
  async mintHiredAgent(input: {
    companyId: string;
    hireId: string;
    candidateId: string;
    finalFirstName: string;
    finalLastName: string;
    finalTitle: string;
    finalTier: "T1" | "T2" | "T3";
    finalAdapterType: string;
    finalDepartmentId?: string | null;
    finalAutonomyLevel?: number;
    roleTemplateKey?: string | null;
  }) {
    return this.db.transaction(async (tx) => {
      const hireRows = await tx
        .select()
        .from(hires)
        .where(and(eq(hires.companyId, input.companyId), eq(hires.id, input.hireId)))
        .limit(1);
      const hire = hireRows[0];
      if (!hire) throw new Error(`Hire ${input.hireId} not found`);
      if (hire.status !== "recommended" && hire.status !== "hired") {
        throw new Error(
          `Cannot mint agent: hire is in '${hire.status}'. Only 'recommended' or 'hired' may mint.`,
        );
      }

      const candRows = await tx
        .select()
        .from(candidates)
        .where(eq(candidates.id, input.candidateId))
        .limit(1);
      const cand = candRows[0];
      if (!cand) throw new Error(`Candidate ${input.candidateId} not found`);
      if (cand.agentId) {
        throw new Error(`Candidate ${input.candidateId} already minted as agent ${cand.agentId}`);
      }

      const first = input.finalFirstName.trim();
      const last = input.finalLastName.trim();
      const title = input.finalTitle.trim();
      if (!first || !last || !title) {
        throw new Error("Name and title are both required to mint an agent");
      }

      const [agent] = await tx
        .insert(agents)
        .values({
          companyId: input.companyId,
          name: `${first} ${last}`.trim(),
          humanFirstName: first,
          humanLastName: last,
          title,
          tier: input.finalTier,
          departmentId: input.finalDepartmentId ?? null,
          autonomyLevel: input.finalAutonomyLevel ?? 1,
          roleTemplateKey: input.roleTemplateKey ?? null,
          adapterType: input.finalAdapterType,
        })
        .returning();

      await tx
        .update(candidates)
        .set({ status: "accepted", agentId: agent.id, updatedAt: new Date() })
        .where(eq(candidates.id, input.candidateId));

      await tx
        .update(hires)
        .set({ status: "hired", updatedAt: new Date() })
        .where(eq(hires.id, input.hireId));

      return agent;
    }).then(async (agent) => {
      // Forensic snapshot: who got minted, from which hire / candidate, at
      // what tier. Recorded outside the tx so an audit write failure can't
      // roll back the mint itself.
      await blackBoxRecorder(this.db).record({
        scope: "hire",
        scopeId: input.hireId,
        label: "agent_minted",
        snapshot: {
          candidateId: input.candidateId,
          agentId: agent.id,
          finalTier: input.finalTier,
          finalAdapterType: input.finalAdapterType,
        },
      });
      return agent;
    });
  }
}

export function hiresService(db: Db): HiresService {
  return new HiresService(db);
}

// Hard rule helper: refuse to mint a non-T3 credential against a row that
// hasn't been hired. Called by the credentials route in Phase 5+.
export function trialCredentialTierAllowed(candidateState: CandidateState, requestedTier: "T1" | "T2" | "T3"): boolean {
  if (candidateState === "accepted") return true;
  return requestedTier === "T3";
}
