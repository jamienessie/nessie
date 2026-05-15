import { useCallback, useMemo } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import type { LiveEvent, LiveEventType } from "@nessie/shared";
import { useLiveEvents } from "./useLiveEvents";

// Bridge between useLiveEvents and React Query: subscribe to a list of
// event types and invalidate the matching queries when an event of that
// type arrives. This is the replacement for `refetchInterval`-based
// polling — caller maps event types to query keys, and the WS push does
// the rest. The hook returns connected: false while the socket is down,
// so a caller can fall back to a longer interval refetch as a safety net
// if it wants.

export interface UseInvalidateOnLiveEventOptions {
  companyId: string | null | undefined;
  /** Mapping of event type → query keys to invalidate when that type arrives. */
  mapping: Partial<Record<LiveEventType, QueryKey[]>>;
  enabled?: boolean;
}

export interface UseInvalidateOnLiveEventResult {
  connected: boolean;
}

export function useInvalidateOnLiveEvent({
  companyId,
  mapping,
  enabled = true,
}: UseInvalidateOnLiveEventOptions): UseInvalidateOnLiveEventResult {
  const qc = useQueryClient();
  const types = useMemo(() => Object.keys(mapping) as LiveEventType[], [mapping]);

  const onEvent = useCallback(
    (event: LiveEvent) => {
      const keys = mapping[event.type];
      if (!keys) return;
      for (const key of keys) {
        qc.invalidateQueries({ queryKey: key });
      }
    },
    [mapping, qc],
  );

  return useLiveEvents({ companyId, types, onEvent, enabled });
}
