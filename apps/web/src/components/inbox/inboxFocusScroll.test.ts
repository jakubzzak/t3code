// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vite-plus/test";
import { inboxFocusScrollDelta } from "./inboxFocusScroll";
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
it("scrolls to a short notification below the viewport after the preceding tall card collapses", () => {
  expect(inboxFocusScrollDelta(450, 530, 0, 300)).toBe(442);
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
  viewport.dataset.slot = "scroll-area-viewport";
  viewport.scrollTo = (options) => {
    viewport.scrollTop = (options as ScrollToOptions).top!;
  };
  const content = document.createElement("div");
  content.dataset.slot = "sidebar-content";
  const list = document.createElement("div");
  list.dataset.inboxList = "";
  const row = document.createElement("article");
  list.append(row);
  content.append(list);
  viewport.append(content);
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
  expect(viewport.scrollTop).toBe(442);
  expect(content.scrollTop).toBe(0);
  // Collapsing the previous tall notification can move the new header above the viewport.
  top = -180;
  list.dispatchEvent(new Event("transitionend", { bubbles: true }));
  vi.advanceTimersByTime(1);
  expect(viewport.scrollTop).toBe(254);
  stop();
  expect(disconnect).toHaveBeenCalled();
  viewport.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each([false, true])(
  "animates toward the final header position without restarting for unchanged geometry (reduced motion: %s)",
  async (reduced) => {
    const { keepInboxRowVisible } = await import("./inboxFocusScroll");
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: reduced }));
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(0), 1),
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
    const viewport = document.createElement("div");
    viewport.dataset.slot = "scroll-area-viewport";
    const list = document.createElement("div");
    list.dataset.inboxList = "";
    const row = document.createElement("article");
    list.append(row);
    viewport.append(list);
    document.body.append(viewport);
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 300 } as DOMRect);
    let contentTop = 500;
    vi.spyOn(row, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          top: contentTop - viewport.scrollTop,
          bottom: contentTop - viewport.scrollTop + 80,
        }) as DOMRect,
    );
    const scroll = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === "object" && options.behavior === "instant")
        viewport.scrollTop = options.top!;
    });
    viewport.scrollTo = scroll;
    const stop = keepInboxRowVisible(row);
    expect(scroll).toHaveBeenLastCalledWith({ top: 492, behavior: reduced ? "instant" : "smooth" });
    // An intermediate native smooth-scroll frame must not restart the same destination.
    viewport.scrollTop = reduced ? 492 : 100;
    list.dispatchEvent(new Event("transitionend", { bubbles: true }));
    vi.advanceTimersByTime(2);
    expect(scroll).toHaveBeenCalledTimes(1);
    // The previous accordion finishing its collapse changes the final destination.
    contentTop = 200;
    list.dispatchEvent(new Event("transitionend", { bubbles: true }));
    vi.advanceTimersByTime(250);
    expect(scroll).toHaveBeenLastCalledWith({ top: 192, behavior: reduced ? "instant" : "smooth" });
    stop();
    if (!reduced) expect(scroll).toHaveBeenLastCalledWith({ top: 100, behavior: "instant" });
  },
);
