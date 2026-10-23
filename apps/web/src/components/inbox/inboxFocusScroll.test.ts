// @vitest-environment jsdom
import { expect, it } from "vite-plus/test";
import { inboxFocusScrollDelta } from "./inboxFocusScroll";
it("scrolls to a short notification below the viewport after the preceding tall card collapses", () => {
  expect(inboxFocusScrollDelta(450, 530, 0, 300)).toBe(238);
});
it("keeps the header of a tall notification visible rather than scrolling to its bottom", () => {
  expect(inboxFocusScrollDelta(400, 1000, 0, 300)).toBe(392);
  expect(inboxFocusScrollDelta(-180, 500, 0, 300)).toBe(-188);
});
it("does not move an already visible notification", () => {
  expect(inboxFocusScrollDelta(12, 240, 0, 300)).toBe(0);
});

it("rechecks the selected row when accordion layout finishes and releases observers", async () => {
  const { keepInboxRowVisible } = await import("./inboxFocusScroll");
  const { vi } = await import("vite-plus/test");
  vi.useFakeTimers();
  let resized: ((entries: ResizeObserverEntry[]) => void) | undefined;
  const disconnect = vi.fn();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: (entries: ResizeObserverEntry[]) => void) {
        resized = callback;
      }
      observe() {}
      unobserve() {}
      disconnect = disconnect;
    },
  );
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  const viewport = document.createElement("div");
  viewport.dataset.slot = "sidebar-content";
  const list = document.createElement("div");
  list.dataset.inboxList = "";
  const row = document.createElement("article");
  list.append(row);
  viewport.append(list);
  document.body.append(viewport);
  let top = 20;
  vi.spyOn(viewport, "getBoundingClientRect").mockImplementation(
    () => ({ top: 0, bottom: 300 }) as DOMRect,
  );
  vi.spyOn(row, "getBoundingClientRect").mockImplementation(
    () => ({ top, bottom: top + 80 }) as DOMRect,
  );
  const stop = keepInboxRowVisible(row);
  expect(viewport.scrollTop).toBe(0);
  top = 450;
  resized!([
    { target: list, contentRect: { width: 200, height: 600 } } as unknown as ResizeObserverEntry,
  ]);
  vi.advanceTimersByTime(1);
  expect(viewport.scrollTop).toBe(238);
  stop();
  expect(disconnect).toHaveBeenCalled();
  viewport.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
