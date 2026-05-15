// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AgentLabel } from "./AgentLabel";
import { getAgentAccent } from "../lib/agent-color";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("AgentLabel", () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it("renders the agent name", () => {
    const root = createRoot(container);
    act(() => {
      root.render(<AgentLabel agent={{ id: "a-1", name: "Aria Whitfield" }} />);
    });
    expect(container.textContent).toContain("Aria Whitfield");
    act(() => root.unmount());
  });

  it("renders title (preferred over role) when showRole is true", () => {
    const root = createRoot(container);
    act(() => {
      root.render(
        <AgentLabel
          agent={{ id: "a-1", name: "Aria Whitfield", title: "CEO", role: "ceo" }}
          showRole
        />,
      );
    });
    expect(container.textContent).toContain("CEO");
    expect(container.textContent).toContain("Aria Whitfield");
    act(() => root.unmount());
  });

  it("falls back to role when title is missing", () => {
    const root = createRoot(container);
    act(() => {
      root.render(<AgentLabel agent={{ id: "a-1", name: "Marcus", role: "cto" }} showRole />);
    });
    expect(container.textContent).toContain("cto");
    act(() => root.unmount());
  });

  it("does not render subtitle when showRole is false", () => {
    const root = createRoot(container);
    act(() => {
      root.render(<AgentLabel agent={{ id: "a-1", name: "Marcus", title: "CTO" }} />);
    });
    expect(container.textContent).not.toContain("CTO");
    act(() => root.unmount());
  });

  it("uses a stable accent dot derived from the id", () => {
    const expected = getAgentAccent("a-stable-id").bg;
    const root = createRoot(container);
    act(() => {
      root.render(<AgentLabel agent={{ id: "a-stable-id", name: "Owen" }} />);
    });
    const dot = container.querySelector("[aria-hidden='true']");
    expect(dot?.className).toContain(expected.split(" ")[0]);
    act(() => root.unmount());
  });

  it("falls back to name for the accent when id is absent", () => {
    const expected = getAgentAccent("Lena Park").bg;
    const root = createRoot(container);
    act(() => {
      root.render(<AgentLabel agent={{ name: "Lena Park" }} />);
    });
    const dot = container.querySelector("[aria-hidden='true']");
    expect(dot?.className).toContain(expected.split(" ")[0]);
    act(() => root.unmount());
  });

  it("emits an aria-label combining name and subtitle", () => {
    const root = createRoot(container);
    act(() => {
      root.render(
        <AgentLabel
          agent={{ id: "a-1", name: "Aria Whitfield", title: "CEO" }}
          showRole
        />,
      );
    });
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.getAttribute("aria-label")).toBe("Aria Whitfield — CEO");
    act(() => root.unmount());
  });
});
