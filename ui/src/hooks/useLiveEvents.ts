import { useEffect, useRef, useState } from "react";
import type { LiveEvent, LiveEventType } from "@nessie/shared";

// Reusable WebSocket subscription to the live-events stream mounted at
// /api/companies/:companyId/events/ws (server: server/src/realtime/
// live-events-ws.ts). Replaces ad-hoc polling intervals throughout the
// Cockpit — see useInvalidateOnLiveEvent for the React Query bridge.
//
// Migration recipe for any place that polls today:
//
//   // before
//   useQuery({ queryKey, queryFn, refetchInterval: 10_000 });
//
//   // after
//   useInvalidateOnLiveEvent({ companyId, mapping: { "agent.status": [queryKey] } });
//   useQuery({ queryKey, queryFn });
//
// The hook handles reconnect with a 1.5s backoff and gracefully closes
// during teardown so the browser console stays quiet on rapid mounts.

export interface UseLiveEventsOptions {
  companyId: string | null | undefined;
  /** When set, only events with type in this list are forwarded to onEvent. */
  types?: ReadonlyArray<LiveEventType>;
  onEvent: (event: LiveEvent) => void;
  enabled?: boolean;
}

export interface UseLiveEventsResult {
  connected: boolean;
}

export function useLiveEvents({
  companyId,
  types,
  onEvent,
  enabled = true,
}: UseLiveEventsOptions): UseLiveEventsResult {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;

  const typesKey = types ? types.slice().sort().join(",") : "";

  useEffect(() => {
    if (!enabled || !companyId) return;

    let closed = false;
    let reconnectTimer: number | null = null;
    let socket: WebSocket | null = null;

    const allow = types && types.length > 0 ? new Set<LiveEventType>(types) : null;

    const scheduleReconnect = () => {
      if (closed) return;
      reconnectTimer = window.setTimeout(connect, 1500);
    };

    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${protocol}://${window.location.host}/api/companies/${encodeURIComponent(companyId)}/events/ws`;
      socket = new WebSocket(url);

      socket.onopen = () => {
        setConnected(true);
      };

      socket.onmessage = (message) => {
        const raw = typeof message.data === "string" ? message.data : "";
        if (!raw) return;
        let event: LiveEvent;
        try {
          event = JSON.parse(raw) as LiveEvent;
        } catch {
          return;
        }
        if (event.companyId !== companyId) return;
        if (allow && !allow.has(event.type)) return;
        onEventRef.current(event);
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        setConnected(false);
        scheduleReconnect();
      };
    };

    connect();

    return () => {
      closed = true;
      setConnected(false);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (socket) {
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        if (socket.readyState === WebSocket.CONNECTING) {
          socket.onopen = () => {
            socket?.close(1000, "useLiveEvents_unmount");
          };
        } else if (socket.readyState === WebSocket.OPEN) {
          socket.close(1000, "useLiveEvents_unmount");
        }
      }
    };
    // typesKey collapses the array dep; companyId/enabled re-trigger on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, enabled, typesKey]);

  return { connected };
}
