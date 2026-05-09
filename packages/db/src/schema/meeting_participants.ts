import { pgTable, uuid, text, timestamp, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { meetings } from "./meetings.js";
import { agents } from "./agents.js";
import { candidates } from "./candidates.js";

// One row per meeting attendee. The attendee may be either a real agent
// (`agent_id`) or a hiring-pipeline candidate persona (`candidate_id`)
// being interviewed before they're minted as an agent. Exactly one of the
// two FKs must be set; the orchestrator branches on which is populated.
//
// Roles distinguish the orchestrator's expectations:
//   host          — operator-acting agent that opened the room
//   panel         — full participant; takes turns, contributes outcomes
//   observer      — reads but doesn't speak (Shadow agents in plan §19.5)
//   interviewer   — HR interview-mode agent that runs the rubric
//   candidate     — the candidate being evaluated; usually backed by a
//                   `candidate_id`, since they don't exist as a real
//                   agent yet
export const meetingParticipants = pgTable(
  "meeting_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").references(() => agents.id),
    candidateId: uuid("candidate_id").references(() => candidates.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("panel"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (table) => ({
    // Exactly-one constraint: either agent_id or candidate_id, never both.
    speakerExclusive: check(
      "meeting_participants_speaker_exclusive",
      sql`(${table.agentId} IS NOT NULL) <> (${table.candidateId} IS NOT NULL)`,
    ),
    // Partial unique indexes: an agent can only attend a meeting once,
    // and likewise for a candidate.
    meetingAgentUniq: uniqueIndex("meeting_participants_meeting_agent_uniq")
      .on(table.meetingId, table.agentId)
      .where(sql`${table.agentId} IS NOT NULL`),
    meetingCandidateUniq: uniqueIndex("meeting_participants_meeting_candidate_uniq")
      .on(table.meetingId, table.candidateId)
      .where(sql`${table.candidateId} IS NOT NULL`),
    agentMeetingIdx: index("meeting_participants_agent_meeting_idx").on(table.agentId, table.meetingId),
  }),
);
