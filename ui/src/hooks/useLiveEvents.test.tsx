// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLiveEvents } from "./useLiveEvents";
import type { LiveEvent } from "@nessie/shared";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

interface OpenedSocket {
  url: string;
  instance: FakeSocket;
}

class FakeSocket {
  static instances: OpenedSocket[] = [];
  static reset() {
    FakeSocket.instances = [];
  }
  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;
  readyState = 0;
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push({ url, instance: this });
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  emit(data: string) {
    this.onmessage?.({ data });
  }
  triggerClose() {
    this.readyState = 3;
    this.onclose?.();
  }
  close() {
    this.closed = true;
    this.readyState = 3;
  }
}

const event = (companyId: string, type: string, payload: Record<string, unknown> = {}): LiveEvent => ({
  id: 1,
  companyId,
  type: type as LiveEvent["type"],
  createdAt: new Date().toISOString(),
  payload,
});

function HookHarness({ companyId, types, onEvent }: {
  companyId: string | null;
  types?: LiveEvent["type"][];
  onEvent: (e: LiveEvent) => void;
}) {
  useLiveEvents({ companyId, types, onEvent });
  return null;
}

describe("useLiveEvents", () => {
  let container: HTMLDivElement;
  let originalWS: typeof WebSocket;

  beforeEach(() => {
    FakeSocket.reset();
    container = document.createElement("div");
    document.body.appendChild(container);
    originalWS = globalThis.WebSocket;
    // @ts-expect-error overriding global for tests
    globalThis.WebSocket = FakeSocket;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.removeChild(container);
    globalThis.WebSocket = originalWS;
  });

  it("opens a WebSocket to /api/companies/:companyId/events/ws", () => {
    const root = createRoot(container);
    act(() => {
      root.render(<HookHarness companyId="co-1" onEvent={() => undefined} />);
    });
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0].url).toContain("/api/companies/co-1/events/ws");
    act(() => root.unmount());
  });

  it("does not open a socket when companyId is null", () => {
    const root = createRoot(container);
    act(() => {
      root.render(<HookHarness companyId={null} onEvent={() => undefined} />);
    });
    expect(FakeSocket.instances).toHaveLength(0);
    act(() => root.unmount());
  });

  it("forwards matching events to onEvent", () => {
    const onEvent = vi.fn();
    const root = createRoot(container);
    act(() => {
      root.render(<HookHarness companyId="co-1" onEvent={onEvent} />);
    });
    const sock = FakeSocket.instances[0].instance;
    act(() => sock.open());
    act(() => sock.emit(JSON.stringify(event("co-1", "agent.status"))));
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0].type).toBe("agent.status");
    act(() => root.unmount());
  });

  it("filters events when types is provided", () => {
    const onEvent = vi.fn();
    const root = createRoot(container);
    act(() => {
      root.render(
        <HookHarness companyId="co-1" types={["agent.status"]} onEvent={onEvent} />,
      );
    });
    const sock = FakeSocket.instances[0].instance;
    act(() => sock.open());
    act(() => sock.emit(JSON.stringify(event("co-1", "heartbeat.run.queued"))));
    act(() => sock.emit(JSON.stringify(event("co-1", "agent.status"))));
    expect(onEvent).toHaveBeenCalledTimes(1);
    expect(onEvent.mock.calls[0][0].type).toBe("agent.status");
    act(() => root.unmount());
  });

  it("ignores events from a different company", () => {
    const onEvent = vi.fn();
    const root = createRoot(container);
    act(() => {
      root.render(<HookHarness companyId="co-1" onEvent={onEvent} />);
    });
    const sock = FakeSocket.instances[0].instance;
    act(() => sock.open());
    act(() => sock.emit(JSON.stringify(event("co-other", "agent.status"))));
    expect(onEvent).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("reconnects after socket close", () => {
    const root = createRoot(container);
    act(() => {
      root.render(<HookHarness companyId="co-1" onEvent={() => undefined} />);
    });
    const first = FakeSocket.instances[0].instance;
    act(() => first.triggerClose());
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(FakeSocket.instances).toHaveLength(2);
    act(() => root.unmount());
  });
});
