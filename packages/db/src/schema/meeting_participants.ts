import { pgTable, uuid, text, timestamp, uniqueIndex, index } from "drizzle-orm/pg-core";
import { meetings } from "./meetings.js";
import { agents } from "./agents.js";

// One row per (meeting, agent). Roles distinguish the orchestrator's
// expectations:
//   host          — operator-acting agent that opened the room
//   panel         — full participant; takes turns, contributes outcomes
//   observer      — reads but doesn't speak (Shadow agents in plan §19.5)
//   interviewer   — HR interview-mode agent that runs the rubric
//   candidate     — the agent being evaluated; T3-credentialled
export const meetingParticipants = pgTable(
  "meeting_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    agentId: uuid("agent_id").notNull().references(() => agents.id),
    role: text("role").notNull().default("panel"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (table) => ({
    meetingAgentUniq: uniqueIndex("meeting_participants_meeting_agent_uniq").on(table.meetingId, table.agentId),
    agentMeetingIdx: index("meeting_participants_agent_meeting_idx").on(table.agentId, table.meetingId),
  }),
);
