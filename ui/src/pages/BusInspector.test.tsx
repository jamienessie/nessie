// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const listMock = vi.fn();
const markStatusMock = vi.fn();

vi.mock("../api/bus", async () => {
  const actual = await vi.importActual<typeof import("../api/bus")>("../api/bus");
  return {
    ...actual,
    busApi: {
      list: (...args: unknown[]) => listMock(...args),
      markStatus: (...args: unknown[]) => markStatusMock(...args),
    },
  };
});

vi.mock("../api/agents", () => ({
  agentsApi: {
    list: () => Promise.resolve([
      { id: "a-from", name: "Aria Whitfield", title: "CEO" },
      { id: "a-to", name: "Marcus Chen", title: "CTO" },
    ]),
  },
}));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({ selectedCompanyId: "co-1" }),
}));

vi.mock("../context/BreadcrumbContext", () => ({
  useBreadcrumbs: () => ({ setBreadcrumbs: vi.fn() }),
}));

vi.mock("../components/EmptyState", () => ({
  EmptyState: ({ message }: { message: string }) => <p data-testid="empty">{message}</p>,
}));

vi.mock("@/components/stack", () => ({
  StackPanel: ({ children, title, right }: { children?: React.ReactNode; title: React.ReactNode; right?: React.ReactNode }) => (
    <section>
      <header>{title}{right}</header>
      {children}
    </section>
  ),
  StackChip: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

import BusInspector from "./BusInspector";

describe("BusInspector", () => {
  let container: HTMLDivElement;
  let qc: QueryClient;

  beforeEach(() => {
    vi.clearAllMocks();
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  function render() {
    const root = createRoot(container);
    act(() => {
      root.render(
        <QueryClientProvider client={qc}>
          <BusInspector />
        </QueryClientProvider>,
      );
    });
    return root;
  }

  it("renders empty state when no messages", async () => {
    listMock.mockResolvedValue({ messages: [] });
    const root = render();
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(container.querySelector("[data-testid='empty']")).not.toBeNull();
    act(() => root.unmount());
  });

  it("renders message rows with from/to agent names and dismiss button on pending", async () => {
    listMock.mockResolvedValue({
      messages: [
        {
          id: "m-1",
          companyId: "co-1",
          fromAgentId: "a-from",
          toAgentId: "a-to",
          kind: "review_request",
          payload: { issueId: "i-1" },
          status: "pending",
          parentMessageId: null,
          expiresAt: null,
          deliveredAt: null,
          repliedAt: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const root = render();
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(container.textContent).toContain("review_request");
    expect(container.textContent).toContain("Aria Whitfield");
    expect(container.textContent).toContain("Marcus Chen");
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.some((b) => b.textContent?.includes("Dismiss"))).toBe(true);
    act(() => root.unmount());
  });
});
