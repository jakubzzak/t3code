// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { ProjectId, type InboxSourceConnection } from "@t3tools/contracts";
import { InboxIntegrationStatus } from "./InboxIntegrationStatus";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.useRealTimers();
});

it("ages a visible failed connection without refetching and refreshes after returning to the page", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T12:00:00Z"));
  const connection: InboxSourceConnection = {
    projectId: ProjectId.make("demo"),
    source: "slack",
    enabled: true,
    connected: true,
    categories: [],
    accounts: [],
    initialLookbackDays: 7,
    lastSyncAt: new Date(Date.now() - 30 * 60_000).toISOString(),
    error: "rate limit reached",
    retryAt: null,
  };
  await act(async () => root.render(<InboxIntegrationStatus connections={[connection]} />));
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
  await act(async () => root.render(<InboxIntegrationStatus connections={[]} />));
  expect(container.querySelector("button")).toBeNull();
});
