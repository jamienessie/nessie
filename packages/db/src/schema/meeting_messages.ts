import { pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { meetings } from "./meetings.js";
import { agents } from "./agents.js";

// Append-only message log for a meeting. Every spoken turn (agent or
// operator) is one row. costCents lifts to meetings.spentCents on
// insert via the meetings service. Tool calls are recorded as a JSON
// array so the Cockpit transcript can render tool-call expansions
// inline.
//
// `role` is the message author kind (not the participant role). It
// distinguishes operator interjections, agent turns, system events
// (state changes), and tool round-trips.

export const meetingMessages = pgTable(
  "meeting_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingId: uuid("meeting_id").notNull().references(() => meetings.id, { onDelete: "cascade" }),
    // Null for operator and system messages (no agent author).
    agentId: uuid("agent_id").references(() => agents.id),
    turnIndex: integer("turn_index").notNull(),
    role: text("role").notNull(), // agent | operator | system | tool
    bodyMarkdown: text("body_markdown").notNull(),
    toolCalls: jsonb("tool_calls").$type<Array<Record<string, unknown>>>().notNull().default([]),
    costCents: integer("cost_cents").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    meetingTurnIdx: index("meeting_messages_meeting_turn_idx").on(table.meetingId, table.turnIndex),
    meetingCreatedIdx: index("meeting_messages_meeting_created_idx").on(table.meetingId, table.createdAt),
  }),
);
