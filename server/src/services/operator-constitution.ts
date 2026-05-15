import { desc, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { operatorConstitution, operatorConstitutionVersions } from "@nessie/db";

// Phase 7. The operator's editable top-level doc. Versioned via a
// transactional snapshot on every upsert so historical operator intent
// is recoverable even after live edits.

export interface ConstitutionInput {
  sections: Record<string, unknown>;
  note?: string | null;
  updatedByUserId?: string | null;
}

export class OperatorConstitutionService {
  constructor(private readonly db: Db) {}

  async getCurrent(companyId: string) {
    const rows = await this.db
      .select()
      .from(operatorConstitution)
      .where(eq(operatorConstitution.companyId, companyId))
      .limit(1);
    return rows[0] ?? null;
  }

  async listVersions(companyId: string) {
    const current = await this.getCurrent(companyId);
    if (!current) return [];
    return this.db
      .select()
      .from(operatorConstitutionVersions)
      .where(eq(operatorConstitutionVersions.constitutionId, current.id))
      .orderBy(desc(operatorConstitutionVersions.version));
  }

  /**
   * Upsert the constitution. Always writes a version snapshot atomically
   * with the head row so a reader can never see a head pointing past the
   * latest snapshot.
   */
  async upsert(companyId: string, input: ConstitutionInput) {
    return this.db.transaction(async (tx) => {
      const existingRows = await tx
        .select()
        .from(operatorConstitution)
        .where(eq(operatorConstitution.companyId, companyId))
        .limit(1);
      const existing = existingRows[0];
      if (existing) {
        const newVersion = existing.version + 1;
        const [updated] = await tx
          .update(operatorConstitution)
          .set({
            sections: input.sections,
            version: newVersion,
            updatedAt: new Date(),
            updatedByUserId: input.updatedByUserId ?? null,
          })
          .where(eq(operatorConstitution.id, existing.id))
          .returning();
        await tx.insert(operatorConstitutionVersions).values({
          constitutionId: existing.id,
          version: newVersion,
          sections: input.sections,
          note: input.note ?? null,
          snapshotByUserId: input.updatedByUserId ?? null,
        });
        return { row: updated, created: false };
      }
      const [created] = await tx
        .insert(operatorConstitution)
        .values({
          companyId,
          sections: input.sections,
          version: 1,
          updatedByUserId: input.updatedByUserId ?? null,
        })
        .returning();
      await tx.insert(operatorConstitutionVersions).values({
        constitutionId: created.id,
        version: 1,
        sections: input.sections,
        note: input.note ?? null,
        snapshotByUserId: input.updatedByUserId ?? null,
      });
      return { row: created, created: true };
    });
  }
}

export function operatorConstitutionService(db: Db): OperatorConstitutionService {
  return new OperatorConstitutionService(db);
}
