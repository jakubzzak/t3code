import { expect, it, vi } from "vite-plus/test";
import { fakeTimers, stubGlobal } from "../../../test/render";
import { keepInboxRowVisible } from "./inboxFocusScroll";

/** A real scroll container, so assigned scroll offsets are not clamped to zero. */
function scrollViewport() {
  const viewport = document.createElement("div");
  viewport.dataset.slot = "scroll-area-viewport";
  viewport.style.cssText = "height: 300px; overflow: auto";
  const spacer = document.createElement("div");
  spacer.style.height = "2000px";
  document.body.append(viewport);
  return {
    viewport,
    /** Appends content and keeps the viewport scrollable below it. */
    fill(...children: HTMLElement[]) {
      viewport.append(...children, spacer);
    },
    [Symbol.dispose]: () => viewport.remove(),
  };
}

function animationFrames(delay: number) {
  const request = stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) =>
    window.setTimeout(() => callback(0), delay),
  );
  const cancel = stubGlobal("cancelAnimationFrame", (id: number) => window.clearTimeout(id));
  return {
    [Symbol.dispose]() {
      cancel[Symbol.dispose]();
      request[Symbol.dispose]();
    },
  };
}

it("brings a focused notification out from behind its sticky section heading", () => {
  using _timers = fakeTimers();
  using _media = stubGlobal("matchMedia", () => ({ matches: true }));
  using scroll = scrollViewport();
  const { viewport } = scroll;
  const list = document.createElement("div");
  list.dataset.inboxList = "";
  const section = document.createElement("section");
  section.dataset.inboxSection = "delegated";
  const header = document.createElement("div");
  header.dataset.inboxSectionHeader = "";
  const row = document.createElement("article");
  section.append(header, row);
  list.append(section);
  scroll.fill(list);
  viewport.scrollTop = 100;
  const scrollTo = vi.fn();
  viewport.scrollTo = scrollTo;
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 300 } as DOMRect);
  vi.spyOn(header, "getBoundingClientRect").mockReturnValue({ height: 32 } as DOMRect);
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 16, bottom: 96 } as DOMRect);
  const stop = keepInboxRowVisible(row);
  expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 76, behavior: "instant" });
  stop();
});

it("rechecks the selected row when accordion layout finishes and releases observers", () => {
  using _timers = fakeTimers();
  let resized: ((entries: ResizeObserverEntry[]) => void) | undefined;
  const disconnect = vi.fn();
  using _observer = stubGlobal(
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
  using _frames = animationFrames(0);
  using scroll = scrollViewport();
  const { viewport } = scroll;
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
  scroll.fill(content);
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
});

it.each([false, true])(
  "animates toward the final header position without restarting for unchanged geometry (reduced motion: %s)",
  (reduced) => {
    using _timers = fakeTimers();
    using _media = stubGlobal("matchMedia", () => ({ matches: reduced }));
    using _frames = animationFrames(1);
    using scroll = scrollViewport();
    const { viewport } = scroll;
    const list = document.createElement("div");
    list.dataset.inboxList = "";
    const row = document.createElement("article");
    list.append(row);
    scroll.fill(list);
    vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({ top: 0, bottom: 300 } as DOMRect);
    let contentTop = 500;
    vi.spyOn(row, "getBoundingClientRect").mockImplementation(
      () =>
        ({
          top: contentTop - viewport.scrollTop,
          bottom: contentTop - viewport.scrollTop + 80,
        }) as DOMRect,
    );
    const scrollTo = vi.fn((options?: ScrollToOptions | number) => {
      if (typeof options === "object" && options.behavior === "instant")
        viewport.scrollTop = options.top!;
    });
    viewport.scrollTo = scrollTo;
    const stop = keepInboxRowVisible(row);
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 492,
      behavior: reduced ? "instant" : "smooth",
    });
    // An intermediate native smooth-scroll frame must not restart the same destination.
    viewport.scrollTop = reduced ? 492 : 100;
    list.dispatchEvent(new Event("transitionend", { bubbles: true }));
    vi.advanceTimersByTime(2);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    // The previous accordion finishing its collapse changes the final destination.
    contentTop = 200;
    list.dispatchEvent(new Event("transitionend", { bubbles: true }));
    vi.advanceTimersByTime(250);
    expect(scrollTo).toHaveBeenLastCalledWith({
      top: 192,
      behavior: reduced ? "instant" : "smooth",
    });
    stop();
    if (!reduced) expect(scrollTo).toHaveBeenLastCalledWith({ top: 100, behavior: "instant" });
  },
);
