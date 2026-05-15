// Plan §next-up. Bus Auto-Reply Rules service.
//
// CRUD + evaluator. Evaluator returns the first matching rule for an
// inbound bus message; the agent-bus service applies the rule action
// (dismiss / auto_reply) before the message reaches the operator inbox.

import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@nessie/db";
import { busAutoReplyRules } from "@nessie/db";
import { logActivity } from "./activity-log.js";

export type BusAutoReplyAction = "dismiss" | "auto_reply";

export interface BusAutoReplyRule {
  id: string;
  companyId: string;
  name: string;
  kind: string;
  fromAgentIds: string[] | null;
  payloadMatch: Record<string, unknown> | null;
  action: BusAutoReplyAction;
  replyTemplate: Record<string, unknown> | null;
  position: number;
  enabled: boolean;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface InboundMessage {
  kind: string;
  fromAgentId: string | null;
  payload: Record<string, unknown>;
}

function toRule(row: typeof busAutoReplyRules.$inferSelect): BusAutoReplyRule {
  return {
    id: row.id,
    companyId: row.companyId,
    name: row.name,
    kind: row.kind,
    fromAgentIds: row.fromAgentIds ?? null,
    payloadMatch: row.payloadMatch ?? null,
    action: row.action as BusAutoReplyAction,
    replyTemplate: row.replyTemplate ?? null,
    position: row.position,
    enabled: row.enabled === "true",
    createdByUserId: row.createdByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function payloadMatches(payload: Record<string, unknown>, match: Record<string, unknown> | null): boolean {
  if (!match) return true;
  for (const [key, expected] of Object.entries(match)) {
    if (payload[key] !== expected) return false;
  }
  return true;
}

export interface BusAutoReplyRulesService {
  list(companyId: string): Promise<BusAutoReplyRule[]>;
  create(input: Omit<BusAutoReplyRule, "id" | "createdAt" | "updatedAt">): Promise<BusAutoReplyRule>;
  update(input: Partial<Omit<BusAutoReplyRule, "id" | "companyId" | "createdAt" | "updatedAt">> & {
    id: string;
    companyId: string;
  }): Promise<BusAutoReplyRule | null>;
  delete(input: { id: string; companyId: string }): Promise<boolean>;
  evaluate(companyId: string, message: InboundMessage): Promise<BusAutoReplyRule | null>;
}

export function busAutoReplyRulesService(db: Db): BusAutoReplyRulesService {
  return {
    async list(companyId) {
      const rows = await db
        .select()
        .from(busAutoReplyRules)
        .where(eq(busAutoReplyRules.companyId, companyId))
        .orderBy(asc(busAutoReplyRules.position), asc(busAutoReplyRules.createdAt));
      return rows.map(toRule);
    },

    async create(input) {
      const [created] = await db
        .insert(busAutoReplyRules)
        .values({
          companyId: input.companyId,
          name: input.name,
          kind: input.kind,
          fromAgentIds: input.fromAgentIds ?? null,
          payloadMatch: input.payloadMatch ?? null,
          action: input.action,
          replyTemplate: input.replyTemplate ?? null,
          position: input.position,
          enabled: input.enabled ? "true" : "false",
          createdByUserId: input.createdByUserId ?? null,
        })
        .returning();
      await logActivity(db, {
        companyId: input.companyId,
        actorType: input.createdByUserId ? "user" : "system",
        actorId: input.createdByUserId ?? "nessie-bus-rules",
        action: "bus_rule.created",
        entityType: "bus_rule",
        entityId: created.id,
        details: { name: input.name, kind: input.kind, action: input.action },
      });
      return toRule(created);
    },

    async update(input) {
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (input.name !== undefined) patch.name = input.name;
      if (input.kind !== undefined) patch.kind = input.kind;
      if (input.fromAgentIds !== undefined) patch.fromAgentIds = input.fromAgentIds;
      if (input.payloadMatch !== undefined) patch.payloadMatch = input.payloadMatch;
      if (input.action !== undefined) patch.action = input.action;
      if (input.replyTemplate !== undefined) patch.replyTemplate = input.replyTemplate;
      if (input.position !== undefined) patch.position = input.position;
      if (input.enabled !== undefined) patch.enabled = input.enabled ? "true" : "false";
      const [updated] = await db
        .update(busAutoReplyRules)
        .set(patch)
        .where(and(eq(busAutoReplyRules.id, input.id), eq(busAutoReplyRules.companyId, input.companyId)))
        .returning();
      return updated ? toRule(updated) : null;
    },

    async delete(input) {
      const result = await db
        .delete(busAutoReplyRules)
        .where(and(eq(busAutoReplyRules.id, input.id), eq(busAutoReplyRules.companyId, input.companyId)))
        .returning({ id: busAutoReplyRules.id });
      return result.length > 0;
    },

    async evaluate(companyId, message) {
      const rows = await db
        .select()
        .from(busAutoReplyRules)
        .where(
          and(
            eq(busAutoReplyRules.companyId, companyId),
            eq(busAutoReplyRules.enabled, "true"),
            eq(busAutoReplyRules.kind, message.kind),
          ),
        )
        .orderBy(asc(busAutoReplyRules.position), asc(busAutoReplyRules.createdAt));
      for (const row of rows) {
        const rule = toRule(row);
        if (rule.fromAgentIds && rule.fromAgentIds.length > 0) {
          if (!message.fromAgentId || !rule.fromAgentIds.includes(message.fromAgentId)) {
            continue;
          }
        }
        if (!payloadMatches(message.payload, rule.payloadMatch)) continue;
        return rule;
      }
      return null;
    },
  };
}
