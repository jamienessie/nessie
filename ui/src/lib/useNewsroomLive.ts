import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ActivityEvent, LiveEvent } from "@nessie/shared";
import { queryKeys } from "./queryKeys";

const NEWSROOM_BUFFER = 50;

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readDetails(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readActorType(value: unknown): ActivityEvent["actorType"] | null {
  if (value === "agent" || value === "user" || value === "system" || value === "plugin") {
    return value;
  }
  return null;
}

/**
 * Builds an ActivityEvent from a live `activity.logged` payload.
 * Returns null if required fields are missing.
 */
function toActivityEvent(event: LiveEvent): ActivityEvent | null {
  const payload = event.payload ?? {};
  const id = readString(payload["id"]);
  const actorType = readActorType(payload["actorType"]);
  const actorId = readString(payload["actorId"]);
  const action = readString(payload["action"]);
  const entityType = readString(payload["entityType"]);
  const entityId = readString(payload["entityId"]);
  if (!id || !actorType || !actorId || !action || !entityType || !entityId) return null;

  const createdAtStr = readString(payload["createdAt"]) ?? event.createdAt;
  return {
    id,
    companyId: event.companyId,
    actorType,
    actorId,
    action,
    entityType,
    entityId,
    agentId: readString(payload["agentId"]),
    runId: readString(payload["runId"]),
    details: readDetails(payload["details"]),
    // `ActivityEvent.createdAt` is typed `Date`; the API client deserializes it
    // as a string. Keep it as a string here — components use `timeAgo()` which
    // accepts both.
    createdAt: new Date(createdAtStr) as unknown as Date,
  };
}

/**
 * Subscribes to the company's live event WebSocket and patches the activity
 * React Query cache with `activity.logged` events as they arrive. The
 * dashboard's existing animation hook (seenActivityIdsRef + activity-row-enter)
 * picks up new entries automatically.
 *
 * Returns nothing — the side effect is the cache mutation. The dashboard's
 * polling query continues to run as a backstop.
 */
export function useNewsroomLive(companyId: string | null | undefined) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!companyId) return;

    let closed = false;
    let reconnectTimer: number | null = null;
    let socket: WebSocket | null = null;

    const handleEvent = (event: LiveEvent) => {
      if (event.companyId !== companyId) return;
      if (event.type !== "activity.logged") return;

      const activity = toActivityEvent(event);
      if (!activity) return;

      queryClient.setQueriesData<ActivityEvent[]>(
        { queryKey: queryKeys.activity(companyId) },
        (current) => {
          if (!current) return current;
          if (current.some((e) => e.id === activity.id)) return current;
          return [activity, ...current].slice(0, NEWSROOM_BUFFER);
        },
      );
    };

    const connect = () => {
      if (closed) return;
      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      const url = `${protocol}://${window.location.host}/api/companies/${encodeURIComponent(companyId)}/events/ws`;
      socket = new WebSocket(url);

      socket.onmessage = (message) => {
        const raw = typeof message.data === "string" ? message.data : "";
        if (!raw) return;
        let parsed: LiveEvent;
        try {
          parsed = JSON.parse(raw) as LiveEvent;
        } catch {
          return;
        }
        handleEvent(parsed);
      };

      socket.onerror = () => {
        socket?.close();
      };

      socket.onclose = () => {
        if (closed) return;
        reconnectTimer = window.setTimeout(connect, 1500);
      };
    };

    connect();

    return () => {
      closed = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (socket) {
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        if (socket.readyState === WebSocket.CONNECTING) {
          socket.onopen = () => socket?.close(1000, "newsroom_unmount");
        } else if (socket.readyState === WebSocket.OPEN) {
          socket.close(1000, "newsroom_unmount");
        }
        socket = null;
      }
    };
  }, [companyId, queryClient]);
}
