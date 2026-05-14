// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const captureMock = vi.fn();
const triageMock = vi.fn();
const listMock = vi.fn();

vi.mock("../api/inbox", () => ({
  inboxApi: {
    list: (...args: unknown[]) => listMock(...args),
    capture: (...args: unknown[]) => captureMock(...args),
    triage: (...args: unknown[]) => triageMock(...args),
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
  StackPanel: ({ children, title }: { children: React.ReactNode; title: React.ReactNode }) => (
    <section data-testid="stack-panel">
      <header>{title}</header>
      {children}
    </section>
  ),
  StackChip: ({ children }: { children: React.ReactNode }) => (
    <span data-testid="chip">{children}</span>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

import InboxCapture from "./InboxCapture";

describe("InboxCapture", () => {
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
          <InboxCapture />
        </QueryClientProvider>,
      );
    });
    return root;
  }

  it("renders the empty state when no items", async () => {
    listMock.mockResolvedValue({ items: [] });
    const root = render();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(container.querySelector("[data-testid='empty']")).not.toBeNull();
    act(() => root.unmount());
  });

  it("renders captured items and triage buttons", async () => {
    listMock.mockResolvedValue({
      items: [
        {
          id: "i-1",
          companyId: "co-1",
          kind: "note",
          bodyMarkdown: "investigate webhook spend",
          refs: [],
          status: "captured",
          capturedByUserId: null,
          triagedAt: null,
          triagedNotes: null,
          promotedKind: null,
          promotedId: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    const root = render();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(container.textContent).toContain("investigate webhook spend");
    const buttons = Array.from(container.querySelectorAll("button"));
    expect(buttons.some((b) => b.textContent?.includes("Dismiss"))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes("Promote to issue"))).toBe(true);
    act(() => root.unmount());
  });

  it("renders the textarea and submit button for capture", async () => {
    listMock.mockResolvedValue({ items: [] });
    const root = render();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const textarea = container.querySelector("textarea");
    const submit = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Capture",
    );
    expect(textarea).not.toBeNull();
    expect(submit).not.toBeNull();
    expect((submit as HTMLButtonElement).disabled).toBe(true); // empty body disables
    act(() => root.unmount());
  });
});
