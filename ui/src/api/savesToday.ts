import { api } from "./client";

export interface TodaysSaves {
  windowFrom: string;
  windowTo: string;
  autoRoutedRuns: number;
  consensusRuns: number;
  consensusSpendCents: number;
  replays: number;
  preflightBlocks: number;
  arenaJudged: number;
}

export const savesTodayApi = {
  fetch: (companyId: string) =>
    api.get<{ saves: TodaysSaves }>(`/saves/today?companyId=${encodeURIComponent(companyId)}`),
};
