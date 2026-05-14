// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useInvalidateOnLiveEvent } from "./useInvalidateOnLiveEvent";
import type { LiveEvent } from "@nessie/shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let onEventRef: ((e: LiveEvent) => void) | null = null;

vi.mock("./useLiveEvents", () => ({
  useLiveEvents: ({ onEvent }: { onEvent: (e: LiveEvent) => void }) => {
    onEventRef = onEvent;
    return { connected: true };
  },
}));

function HookHarness({ companyId, mapping }: {
  companyId: string;
  mapping: Parameters<typeof useInvalidateOnLiveEvent>[0]["mapping"];
}) {
  useInvalidateOnLiveEvent({ companyId, mapping });
  return null;
}

function makeEvent(type: string): LiveEvent {
  return {
    id: 1,
    companyId: "co-1",
    type: type as LiveEvent["type"],
    createdAt: new Date().toISOString(),
    payload: {},
  };
}

describe("useInvalidateOnLiveEvent", () => {
  let container: HTMLDivElement;
  let qc: QueryClient;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let invalidateSpy: any;

  beforeEach(() => {
    onEventRef = null;
    container = document.createElement("div");
    document.body.appendChild(container);
    qc = new QueryClient();
    invalidateSpy = vi.spyOn(qc, "invalidateQueries");
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function render(mapping: Parameters<typeof useInvalidateOnLiveEvent>[0]["mapping"]) {
    const root = createRoot(container);
    act(() => {
      root.render(
        <QueryClientProvider client={qc}>
          <HookHarness companyId="co-1" mapping={mapping} />
        </QueryClientProvider>,
      );
    });
    return root;
  }

  it("invalidates mapped query keys when matching event arrives", () => {
    const root = render({ "agent.status": [["agents", "co-1"]] });
    expect(onEventRef).not.toBeNull();
    act(() => onEventRef!(makeEvent("agent.status")));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agents", "co-1"] });
    act(() => root.unmount());
  });

  it("invalidates multiple keys for the same event type", () => {
    const root = render({
      "heartbeat.run.status": [["liveRuns", "co-1"], ["agents", "co-1"]],
    });
    act(() => onEventRef!(makeEvent("heartbeat.run.status")));
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["liveRuns", "co-1"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["agents", "co-1"] });
    act(() => root.unmount());
  });

  it("does not invalidate for unmapped event types", () => {
    const root = render({ "agent.status": [["agents", "co-1"]] });
    act(() => onEventRef!(makeEvent("activity.logged")));
    expect(invalidateSpy).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
