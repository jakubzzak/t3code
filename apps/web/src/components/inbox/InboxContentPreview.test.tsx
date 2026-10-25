// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { InboxContentPreview } from "./InboxContentPreview";
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("expands each overflowing preview independently and updates controls after a resize", async () => {
  let height = 120;
  let resized = () => {};
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(() => ({
    width: 300,
    height,
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 300,
    bottom: height,
    toJSON: () => ({}),
  }));
  vi.stubGlobal("getComputedStyle", () => ({ lineHeight: "20px" }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      elements = new Set<Element>();
      constructor(callback: ResizeObserverCallback) {
        resized = () => {
          callback(
            [...this.elements].map(
              (target) => ({ target, contentRect: { width: 300, height } }) as ResizeObserverEntry,
            ),
            this as unknown as ResizeObserver,
          );
        };
      }
      observe(element: Element) {
        this.elements.add(element);
      }
      unobserve(element: Element) {
        this.elements.delete(element);
      }
      disconnect() {}
    },
  );
  await act(async () =>
    root.render(
      <>
        <section aria-label="Description">
          <InboxContentPreview lines={8}>Description</InboxContentPreview>
        </section>
        <section aria-label="Comment">
          <InboxContentPreview lines={4}>Comment</InboxContentPreview>
        </section>
        <section aria-label="Other comment">
          <InboxContentPreview lines={4}>Other comment</InboxContentPreview>
        </section>
      </>,
    ),
  );
  const description = () => container.querySelector('section[aria-label="Description"]')!;
  const comment = () => container.querySelector('section[aria-label="Comment"]')!;
  expect(description().querySelector("button")).toBeNull();
  expect(comment().querySelector("button")?.textContent).toBe("Read more");
  await act(async () => {
    height = 240;
    resized();
  });
  await act(async () => description().querySelector<HTMLButtonElement>("button")!.click());
  expect(description().querySelector("button")?.textContent).toBe("Show less");
  expect(comment().querySelector("button")?.textContent).toBe("Read more");
  await act(async () => comment().querySelector<HTMLButtonElement>("button")!.click());
  expect(comment().querySelector("button")?.textContent).toBe("Show less");
  expect(container.querySelector('section[aria-label="Other comment"] button')?.textContent).toBe(
    "Read more",
  );
  await act(async () => description().querySelector<HTMLButtonElement>("button")!.click());
  expect(description().querySelector("button")?.textContent).toBe("Read more");
  expect(comment().querySelector("button")?.textContent).toBe("Show less");
  await act(async () => {
    height = 40;
    resized();
  });
  expect(container.querySelectorAll("button")).toHaveLength(0);
});
