import { expect, it, vi } from "vite-plus/test";
import { act, fakeTimers, render } from "../../../test/render";
import { IntegrationConnectionTitle } from "./IntegrationConnectionTitle";

function view(lastSyncAt?: string | null) {
  return <IntegrationConnectionTitle lastSyncAt={lastSyncAt ?? null} />;
}

function clock() {
  const timers = fakeTimers();
  vi.setSystemTime(new Date(2026, 9, 24, 10));
  return timers;
}

it("ages an open connection's sync label and switches to the clock at one hour", async () => {
  using _timers = clock();
  await using screen = await render(view(new Date(2026, 9, 24, 9, 1).toISOString()), {
    router: false,
  });
  expect(screen.container.querySelector("time")?.textContent).toBe("59 minutes ago");
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(screen.container.querySelector("time")?.textContent).toBe("09:01");
});

it("immediately reflects a new sync between minute ticks", async () => {
  using _timers = clock();
  await using screen = await render(view(new Date(2026, 9, 24, 9, 55).toISOString()), {
    router: false,
  });
  expect(screen.container.querySelector("time")?.textContent).toBe("5 minutes ago");
  await act(async () => vi.advanceTimersByTime(30_000));
  await screen.rerender(view(new Date(2026, 9, 24, 10, 0, 30).toISOString()));
  expect(screen.container.querySelector("time")?.textContent).toBe("0 minutes ago");
  await act(async () => vi.advanceTimersByTime(60_000));
  expect(screen.container.querySelector("time")?.textContent).toBe("1 minute ago");
});

it("keeps connections without a sync timestamp free of labels and clocks", async () => {
  using _timers = clock();
  await using screen = await render(view(null), { router: false });
  expect(screen.container.textContent).toBe("Connection");
  expect(screen.container.querySelector("time")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
