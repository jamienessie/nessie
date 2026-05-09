-- Allow meeting_participants to reference either an agent (existing) or
-- a hiring-pipeline candidate persona (new). Exactly one of the two FKs
-- must be set, enforced by a CHECK constraint.

ALTER TABLE "meeting_participants"
  ADD COLUMN "candidate_id" uuid REFERENCES "candidates"("id") ON DELETE CASCADE;
--> statement-breakpoint

ALTER TABLE "meeting_participants"
  ALTER COLUMN "agent_id" DROP NOT NULL;
--> statement-breakpoint

-- Drop the existing strict unique index — we'll replace it with two
-- partial uniques so an agent can only attend a meeting once and the
-- same for a candidate.
DROP INDEX IF EXISTS "meeting_participants_meeting_agent_uniq";
--> statement-breakpoint

CREATE UNIQUE INDEX "meeting_participants_meeting_agent_uniq"
  ON "meeting_participants" ("meeting_id", "agent_id")
  WHERE "agent_id" IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX "meeting_participants_meeting_candidate_uniq"
  ON "meeting_participants" ("meeting_id", "candidate_id")
  WHERE "candidate_id" IS NOT NULL;
--> statement-breakpoint

ALTER TABLE "meeting_participants"
  ADD CONSTRAINT "meeting_participants_speaker_exclusive"
  CHECK ((agent_id IS NOT NULL) <> (candidate_id IS NOT NULL));
