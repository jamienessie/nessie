import type { Db } from "@nessie/db";
import { agentBusService, type BusKind } from "./agent-bus.js";

// Agent-context wrappers around agentBusService.send. Stamps
// senderAutonomyLevel from the agent record so Phase 6 gating actually
// fires when an agent (vs the operator) produces a bus message. Without
// this stamp every agent-driven send bypasses the canSendBusKindAtLevel
// + requiresOperatorApproval rewrap.

export interface AgentBusSender {
  id: string;
  companyId: string;
  autonomyLevel: number;
}

export async function sendAsAgent(
  db: Db,
  fromAgent: AgentBusSender,
  input: {
    kind: BusKind;
    toAgentId?: string | null;
    payload: Record<string, unknown>;
    parentMessageId?: string | null;
    expiresAt?: Date | null;
  },
) {
  return agentBusService(db).send({
    companyId: fromAgent.companyId,
    fromAgentId: fromAgent.id,
    senderAutonomyLevel: fromAgent.autonomyLevel,
    ...input,
  });
}

// Operator-context send. Bypasses senderAutonomyLevel gating because the
// operator is the trust root.
export async function sendFromOperator(
  db: Db,
  companyId: string,
  input: {
    kind: BusKind;
    toAgentId?: string | null;
    payload: Record<string, unknown>;
    parentMessageId?: string | null;
    expiresAt?: Date | null;
  },
) {
  return agentBusService(db).send({
    companyId,
    fromAgentId: null,
    ...input,
  });
}
