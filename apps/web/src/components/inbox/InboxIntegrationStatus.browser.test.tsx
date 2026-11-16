import type { ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../../test/render";
import { ProjectId, type InboxSourceConnection } from "@t3tools/contracts";
import { InboxIntegrationStatus } from "./InboxIntegrationStatus";

const container = document.createElement("div");
const mount = (ui: ReactNode) => render(ui, { container, router: false });

it("ages a visible failed connection without refetching and refreshes after returning to the page", async () => {
  using _timers = fakeTimers();
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
  const connection: InboxSourceConnection = {
    projectId: ProjectId.make("demo"),
    source: "slack",
    enabled: true,
    connected: true,
    categories: [],
    accounts: [],
    initialLookbackDays: 7,
    lastSyncAt: "2026-11-01T11:30:00Z",
    error: "rate limit reached",
    retryAt: null,
  };
  await using screen = await mount(<InboxIntegrationStatus connections={[connection]} />);
  const button = container.querySelector("button")!;
  const dot = button.querySelector("span")!;
  const initialColor = dot.style.backgroundColor;
  await act(async () => {
    button.click();
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain(
    "Last synced 30m ago",
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(45 * 60_000);
  });
  expect(dot.style.backgroundColor).not.toBe(initialColor);
  expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain(
    "Last synced 1h 15m ago",
  );
  await act(async () => {
    vi.setSystemTime(new Date("2026-11-01T13:30:00Z"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(document.body.querySelector('[role="tooltip"]')?.textContent).toContain(
    "Last synced 2h ago",
  );
  const red = dot.style.backgroundColor;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(30 * 60_000);
  });
  expect(dot.style.backgroundColor).toBe(red);
  await screen.rerender(<InboxIntegrationStatus connections={[]} />);
  expect(container.querySelector("button")).toBeNull();
});

it("reveals the status on focus, dismisses with Escape and reopens without moving focus", async () => {
  using _timers = fakeTimers();
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
  const connection: InboxSourceConnection = {
    projectId: ProjectId.make("keyboard"),
    source: "slack",
    enabled: true,
    connected: true,
    categories: [],
    accounts: [],
    initialLookbackDays: 7,
    lastSyncAt: "2026-11-01T11:46:00Z",
    error: "rate limit",
    retryAt: null,
  };
  await using _screen = await mount(<InboxIntegrationStatus connections={[connection]} />);
  const button = container.querySelector("button")!;
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    button.focus();
  });
  expect(document.activeElement).toBe(button);
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    "Slack updates delayed",
  );
  expect(document.getElementById(button.getAttribute("aria-describedby")!)?.textContent).toContain(
    "Last synced 14m ago",
  );
  await act(async () =>
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(button.getAttribute("aria-describedby")).toBeNull();
  expect(document.activeElement).toBe(button);
  await act(async () => button.click());
  expect(button.getAttribute("aria-describedby")).not.toBeNull();
  expect(document.activeElement).toBe(button);
  await act(async () => {
    button.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(button.getAttribute("aria-describedby")).toBeNull();
});

it("keeps a hover disclosure open over its text and closes it on Escape", async () => {
  using _timers = fakeTimers();
  const connection: InboxSourceConnection = {
    projectId: ProjectId.make("hover"),
    source: "linear",
    enabled: true,
    connected: true,
    categories: [],
    accounts: [],
    initialLookbackDays: 7,
    lastSyncAt: null,
    error: "temporarily unavailable",
    retryAt: null,
  };
  await using _screen = await mount(<InboxIntegrationStatus connections={[connection]} />);
  const button = container.querySelector("button")!;
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 20, 24, 24));
  await act(async () => {
    button.dispatchEvent(new MouseEvent("mouseenter", { clientX: 20, clientY: 30 }));
    button.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 30, bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);
  });
  const popup = document.querySelector<HTMLElement>('[role="tooltip"]')!;
  expect(popup.textContent).toBe("Linear updates delayed · Never synced");
  vi.spyOn(popup, "getBoundingClientRect").mockReturnValue(new DOMRect(10, 48, 200, 32));
  // jsdom has no hit testing; the built-in Browser pass also checks that CSS lets the pointer reach this popup.
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent("mouseleave", { relatedTarget: popup, clientX: 20, clientY: 50 }),
    );
    popup.dispatchEvent(
      new MouseEvent("mouseenter", { relatedTarget: button, clientX: 20, clientY: 50 }),
    );
    popup.dispatchEvent(new MouseEvent("mousemove", { clientX: 20, clientY: 50, bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(button.getAttribute("aria-describedby")).not.toBeNull();
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(
    "Linear updates delayed · Never synced",
  );
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
});
