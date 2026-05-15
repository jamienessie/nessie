import { useQuery } from "@tanstack/react-query";
import { useInvalidateOnLiveEvent } from "../hooks/useInvalidateOnLiveEvent";
import { savesTodayApi } from "../api/savesToday";
import { formatCents, formatNumber } from "../lib/utils";

interface Props {
  companyId: string | null | undefined;
}

function tile(label: string, value: string, accent: string, sub?: string) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded-md border bg-background px-3 py-2"
      style={{ borderLeft: `4px solid ${accent}` }}
    >
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-bold leading-tight">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

// Today's Saves — small KPI strip surfaced on the Dashboard. Tells the
// free-tier wins story: how many runs got auto-routed, consensus'd,
// replayed, or pre-flight-blocked over the current UTC day, plus how
// many Arena runs landed a winner.
//
// Subscribes to the relevant live events so the row ticks up in real
// time as features fire.
export function TodaysSavesRow({ companyId }: Props) {
  const q = useQuery({
    queryKey: ["saves-today", companyId],
    queryFn: () =>
      companyId
        ? savesTodayApi.fetch(companyId)
        : Promise.resolve({ saves: null as never }),
    enabled: Boolean(companyId),
    refetchInterval: 60_000,
  });
  useInvalidateOnLiveEvent({
    companyId: companyId ?? null,
    mapping: {
      "heartbeat.auto_routed": [["saves-today", companyId]],
      "heartbeat.consensus_landed": [["saves-today", companyId]],
      "heartbeat.preflight_failed": [["saves-today", companyId]],
      "replay.completed": [["saves-today", companyId]],
      "arena.run.judged": [["saves-today", companyId]],
    },
  });

  const saves = q.data?.saves ?? null;
  if (!saves) {
    return null;
  }
  const any =
    saves.autoRoutedRuns + saves.consensusRuns + saves.replays + saves.preflightBlocks + saves.arenaJudged > 0;
  if (!any) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
        Today's saves · UTC day so far
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
        {tile("auto-routed", formatNumber(saves.autoRoutedRuns), "#22C2A4", "runs sent to leaderboard winner")}
        {tile(
          "consensus",
          formatNumber(saves.consensusRuns),
          "#1FA7FF",
          saves.consensusSpendCents > 0 ? `${formatCents(saves.consensusSpendCents)} spent` : "runs fanned out",
        )}
        {tile("replays", formatNumber(saves.replays), "#7C5CFF", "alt-config compared")}
        {tile("pre-flight blocks", formatNumber(saves.preflightBlocks), "#FF6B9A", "bad runs avoided")}
        {tile("arena wins", formatNumber(saves.arenaJudged), "#FFB400", "leaderboard updates")}
      </div>
    </div>
  );
}
