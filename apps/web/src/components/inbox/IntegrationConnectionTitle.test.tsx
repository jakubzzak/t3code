// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { IntegrationConnectionTitle } from "./IntegrationConnectionTitle";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 24, 10));
});
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.useRealTimers();
});
const render = (lastSyncAt?: string | null) =>
  act(async () => root.render(<IntegrationConnectionTitle lastSyncAt={lastSyncAt ?? null} />));

it("ages an open connection's sync label and switches to the clock at one hour", async () => {
  await render(new Date(2026, 9, 24, 9, 1).toISOString());
  expect(container.querySelector("time")?.textContent).toBe("59 minutes ago");
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(container.querySelector("time")?.textContent).toBe("09:01");
});

it("immediately reflects a new sync between minute ticks", async () => {
  await render(new Date(Date.now() - 5 * 60_000).toISOString());
  expect(container.querySelector("time")?.textContent).toBe("5 minutes ago");
  await act(async () => vi.advanceTimersByTime(30_000));
  await render(new Date().toISOString());
  expect(container.querySelector("time")?.textContent).toBe("0 minutes ago");
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(container.querySelector("time")?.textContent).toBe("1 minute ago");
});

it("keeps connections without a sync timestamp free of labels and clocks", async () => {
  await render(null);
  expect(container.textContent).toBe("Connection");
  expect(container.querySelector("time")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
