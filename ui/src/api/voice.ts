import { api } from "./client";

export interface VoiceTurn {
  role: "user" | "ceo";
  text: string;
}

export interface VoiceReply {
  reply: string;
  source: "llm" | "template";
  warning: string | null;
}

export const voiceApi = {
  turn: (companyId: string, message: string, history: VoiceTurn[]) =>
    api.post<VoiceReply>(`/companies/${companyId}/voice/turn`, { message, history }),
};
