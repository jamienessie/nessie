import { Router } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@nessie/db";
import { companies as companiesTable } from "@nessie/db";
import { validate } from "../middleware/validate.js";
import { assertCompanyAccess, getActorInfo } from "./authz.js";
import { logActivity } from "../services/activity-log.js";
import { callNessieProxy, type LlmMessage } from "../services/llm-call.js";

// Voice mode — talk to your CEO.
//
// MVP scope: browser does STT (webkitSpeechRecognition) and TTS
// (speechSynthesis); the server only handles the conversational turn. The
// reply is templated for now; swapping it for a real Claude call later is
// localised to `composeReply`. Conversation history is stored client-side
// in MVP — a follow-up will persist turns onto a "voice strategy" issue.

const voiceTurnSchema = z.object({
  message: z.string().trim().min(1).max(2000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "ceo"]),
        text: z.string().min(1).max(2000),
      }),
    )
    .max(40)
    .optional()
    .default([]),
});

function templateReply(message: string, history: { role: "user" | "ceo"; text: string }[]): string {
  const turn = (history.filter((h) => h.role === "user").length) + 1;
  const lower = message.toLowerCase();
  if (turn === 1) {
    return `Good to talk. You said: "${message.trim()}". Tell me where you want me to focus today — strategy, hiring, or budget — and I'll give you the one thing I'd do next.`;
  }
  if (lower.includes("hire") || lower.includes("recruit")) {
    return "Hiring's the leverage move when the bottleneck is a person. Tell me which seat is empty today and I'll write the JD.";
  }
  if (lower.includes("budget") || lower.includes("spend") || lower.includes("cost")) {
    return "On budget: the only spend worth keeping is what ships a deliverable in the next 14 days. Want me to cut a list?";
  }
  if (lower.includes("status") || lower.includes("update")) {
    return "Tactically the team is shipping; strategically we're a step behind on customer conversations. Want me to fix that this afternoon?";
  }
  return `Heard. The one move I'd make on \"${message.trim().slice(0, 80)}\": pick the smallest version that ships in seven days, then re-evaluate.`;
}

function buildVoicePrompt(input: {
  companyName: string;
  companyDescription: string | null;
  message: string;
  history: { role: "user" | "ceo"; text: string }[];
}): LlmMessage[] {
  const system: LlmMessage = {
    role: "system",
    content:
      `You are the CEO of "${input.companyName}". You are speaking to your board (the operator, a human) via voice. Keep replies to 1-3 sentences — they will be read aloud by TTS. Be sharp, opinionated, and concrete. No emoji, no filler, no markdown. Reference the company's own situation when you can.` +
      (input.companyDescription ? `\n\nCompany context: ${input.companyDescription}` : ""),
  };
  const past: LlmMessage[] = input.history.slice(-12).map((turn) => ({
    role: turn.role === "ceo" ? "assistant" : "user",
    content: turn.text,
  }));
  return [system, ...past, { role: "user", content: input.message }];
}

export function voiceRoutes(db: Db) {
  const router = Router();

  router.post("/companies/:companyId/voice/turn", validate(voiceTurnSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const message = req.body.message as string;
    const history = (req.body.history ?? []) as { role: "user" | "ceo"; text: string }[];

    // Pull company name/description so the CEO can reference its own situation.
    const company = await db
      .select({ name: companiesTable.name, description: companiesTable.description })
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId))
      .then((rows) => rows[0] ?? null);
    if (!company) {
      res.status(404).json({ error: "Company not found" });
      return;
    }

    const llm = await callNessieProxy({
      companyId,
      messages: buildVoicePrompt({
        companyName: company.name,
        companyDescription: company.description ?? null,
        message,
        history,
      }),
      temperature: 0.7,
      maxTokens: 220,
    });

    let reply: string;
    let source: "llm" | "template" = "template";
    let warning: string | null = null;

    if (llm.ok) {
      reply = llm.text;
      source = "llm";
    } else {
      reply = templateReply(message, history);
      warning = llm.fix;
    }

    const actor = getActorInfo(req);
    await logActivity(db, {
      companyId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      agentId: actor.agentId,
      runId: actor.runId,
      action: "voice.turn",
      entityType: "company",
      entityId: companyId,
      details: {
        messagePreview: message.slice(0, 120),
        replyPreview: reply.slice(0, 120),
        source,
      },
    });

    res.json({ reply, source, warning });
  });

  return router;
}
