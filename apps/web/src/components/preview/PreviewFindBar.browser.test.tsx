import type { DesktopPreviewFindResult } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { PreviewFindBar } from "./PreviewFindBar";

it("searches, ignores stale results, moves between matches, and clears on close", async () => {
  const requests: Array<(result: DesktopPreviewFindResult | null) => void> = [];
  const bridge = {
    findInPage: vi.fn(
      () => new Promise<DesktopPreviewFindResult | null>((resolve) => requests.push(resolve)),
    ),
    stopFindInPage: vi.fn(async () => undefined),
  };
  const close = vi.fn();
  await using screen = await render(
    <PreviewFindBar tabId="tab" bridge={bridge} focusNonce={1} onClose={close} />,
  );
  const input = screen.getByRole("textbox", { name: "Find in page" });
  const status = screen.getByRole("status");
  expect(document.activeElement).toBe(input.element());
  await userEvent.fill(input, "old");
  await userEvent.fill(input, "new");
  expect(bridge.findInPage).toHaveBeenLastCalledWith("tab", "new", {
    forward: true,
    findNext: false,
  });
  // The stale "old" result lands after the current one and must not replace it.
  await act(() => {
    requests[1]!({ matches: 3, activeMatchOrdinal: 1 });
    requests[0]!({ matches: 9, activeMatchOrdinal: 7 });
  });
  await expect.element(status).toHaveTextContent("1 of 3");
  await userEvent.keyboard("{Shift>}{Enter}{/Shift}");
  expect(bridge.findInPage).toHaveBeenLastCalledWith("tab", "new", {
    forward: false,
    findNext: true,
  });
  await act(() => requests[2]!({ matches: 0, activeMatchOrdinal: 0 }));
  await expect.element(status).toHaveTextContent("No matches");
  await userEvent.keyboard("{Escape}");
  expect(close).toHaveBeenCalledOnce();
  await screen.unmount();
  expect(bridge.stopFindInPage).toHaveBeenCalledWith("tab");
});

it("reports search failure and allows a new search to recover", async () => {
  const bridge = {
    findInPage: vi
      .fn()
      .mockRejectedValueOnce(new Error("Guest unavailable"))
      .mockResolvedValue({ matches: 2, activeMatchOrdinal: 1 }),
    stopFindInPage: vi.fn(async () => undefined),
  };
  await using screen = await render(
    <PreviewFindBar tabId="tab" bridge={bridge} focusNonce={1} onClose={() => undefined} />,
  );
  const input = screen.getByRole("textbox", { name: "Find in page" });
  const status = screen.getByRole("status");
  await userEvent.fill(input, "first");
  await expect.element(status).toHaveTextContent("Unable to search page");
  await userEvent.fill(input, "retry");
  await expect.element(status).toHaveTextContent("1 of 2");
  input.element().blur();
  await screen.rerender(
    <PreviewFindBar tabId="tab" bridge={bridge} focusNonce={2} onClose={() => undefined} />,
  );
  const field = input.element() as HTMLInputElement;
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(0);
  expect(field.selectionEnd).toBe(5);
});
