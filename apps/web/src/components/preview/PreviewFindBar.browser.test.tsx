import type { DesktopPreviewFindResultEvent } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { PreviewFindBar } from "./PreviewFindBar";

const bridge = vi.hoisted(() => ({
  listeners: new Set<(event: DesktopPreviewFindResultEvent) => void>(),
  findInPage: vi.fn(async (..._args: ReadonlyArray<unknown>) => undefined),
  stopFindInPage: vi.fn(async (_tabId: string) => undefined),
}));

vi.mock("./previewBridge", () => ({
  previewBridge: {
    findInPage: bridge.findInPage,
    stopFindInPage: bridge.stopFindInPage,
    onFindResult: (listener: (event: DesktopPreviewFindResultEvent) => void) => {
      bridge.listeners.add(listener);
      return () => bridge.listeners.delete(listener);
    },
  },
}));

const emit = (event: DesktopPreviewFindResultEvent) =>
  act(() => {
    for (const listener of bridge.listeners) listener(event);
  });

function freshBridge(): Disposable {
  return {
    [Symbol.dispose]: () => {
      bridge.listeners.clear();
      bridge.findInPage.mockClear();
      bridge.stopFindInPage.mockClear();
    },
  };
}

it("searches, ignores other tabs, moves between matches, and stops on close", async () => {
  using _bridge = freshBridge();
  const close = vi.fn();
  await using screen = await render(
    <PreviewFindBar tabId="tab" focusRequestId={1} onClose={close} />,
  );
  const input = screen.getByRole("searchbox", { name: "Find in page" });
  expect(document.activeElement).toBe(input.element());

  await userEvent.fill(input, "new");
  expect(bridge.findInPage).toHaveBeenLastCalledWith("tab", "new", {
    forward: true,
    newSession: true,
  });
  await emit({ tabId: "other", matches: 9, activeMatchOrdinal: 7 });
  await emit({ tabId: "tab", matches: 3, activeMatchOrdinal: 1 });
  await expect.element(screen.getByText("1/3")).toBeInTheDocument();

  await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
  expect(bridge.findInPage).toHaveBeenLastCalledWith("tab", "new", {
    forward: false,
    newSession: false,
  });
  // Chromium reports -1 for fields an update leaves unchanged.
  await emit({ tabId: "tab", matches: -1, activeMatchOrdinal: 3 });
  await expect.element(screen.getByText("3/3")).toBeInTheDocument();

  await userEvent.keyboard("{Escape}");
  expect(close).toHaveBeenCalledOnce();
  await screen.unmount();
  expect(bridge.stopFindInPage).toHaveBeenCalledWith("tab");
});

it("refocuses and selects the query when find is requested again", async () => {
  using _bridge = freshBridge();
  await using screen = await render(
    <PreviewFindBar tabId="tab" focusRequestId={1} onClose={() => undefined} />,
  );
  const input = screen.getByRole("searchbox", { name: "Find in page" });
  await userEvent.fill(input, "retry");
  input.element().blur();
  await screen.rerender(
    <PreviewFindBar tabId="tab" focusRequestId={2} onClose={() => undefined} />,
  );
  const field = input.element() as HTMLInputElement;
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(5);
});
