// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import type { DesktopPreviewFindResult } from "@t3tools/contracts";
import { PreviewFindBar } from "./PreviewFindBar";

it("searches, ignores stale results, moves between matches, and clears on close", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const requests: Array<(result: DesktopPreviewFindResult | null) => void> = [];
  const bridge = {
    findInPage: vi.fn(
      () => new Promise<DesktopPreviewFindResult | null>((resolve) => requests.push(resolve)),
    ),
    stopFindInPage: vi.fn(async () => undefined),
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const close = vi.fn();
  try {
    await act(async () =>
      root.render(<PreviewFindBar tabId="tab" bridge={bridge} focusNonce={1} onClose={close} />),
    );
    const input = container.querySelector("input")!;
    expect(document.activeElement).toBe(input);
    const type = async (text: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          text,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await type("old");
    await type("new");
    expect(bridge.findInPage).toHaveBeenLastCalledWith("tab", "new", {
      forward: true,
      findNext: false,
    });
    await act(async () => requests[1]!({ matches: 3, activeMatchOrdinal: 1 }));
    await act(async () => requests[0]!({ matches: 9, activeMatchOrdinal: 7 }));
    expect(container.querySelector('[role="status"]')!.textContent).toBe("1 of 3");
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(bridge.findInPage).toHaveBeenLastCalledWith("tab", "new", {
      forward: false,
      findNext: true,
    });
    await act(async () => requests[2]!({ matches: 0, activeMatchOrdinal: 0 }));
    expect(container.textContent).toContain("No matches");
    await act(async () =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
      ),
    );
    expect(close).toHaveBeenCalledOnce();
  } finally {
    await act(async () => root.unmount());
    expect(bridge.stopFindInPage).toHaveBeenCalledWith("tab");
    container.remove();
    vi.unstubAllGlobals();
  }
});

it("reports search failure and allows a new search to recover", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const bridge = {
    findInPage: vi
      .fn()
      .mockRejectedValueOnce(new Error("Guest unavailable"))
      .mockResolvedValue({ matches: 2, activeMatchOrdinal: 1 }),
    stopFindInPage: vi.fn(async () => undefined),
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <PreviewFindBar tabId="tab" bridge={bridge} focusNonce={1} onClose={() => undefined} />,
      ),
    );
    const input = container.querySelector("input")!;
    const type = async (text: string) =>
      act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
          input,
          text,
        );
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    await type("first");
    expect(container.textContent).toContain("Unable to search page");
    await type("retry");
    expect(container.textContent).toContain("1 of 2");
    input.blur();
    await act(async () =>
      root.render(
        <PreviewFindBar tabId="tab" bridge={bridge} focusNonce={2} onClose={() => undefined} />,
      ),
    );
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(5);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
