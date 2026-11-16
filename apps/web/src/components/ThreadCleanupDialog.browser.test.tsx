import { EnvironmentId, ThreadId, type ThreadCleanupSnapshot } from "@t3tools/contracts";
import {
  getCleanupRequest,
  requestThreadCleanup,
} from "@t3tools/client-runtime/state/thread-cleanup";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { act, fakeTimers, render } from "../../test/render";
import { ThreadCleanupDialog } from "./ThreadCleanupDialog";

const io = vi.hoisted(() => ({
  start: vi.fn(),
  stream: { _tag: "Initial" } as { _tag: string; value?: ThreadCleanupSnapshot },
  closeTools: vi.fn(),
}));
vi.mock(import("@effect/atom-react"), async (original) => ({
  ...(await original()),
  useAtomValue: (() => io.stream) as never,
}));
vi.mock(import("../state/threads"), async (original) => ({
  ...(await original()),
  threadEnvironment: { cleanupState: () => null, cleanupStart: null } as never,
}));
vi.mock(import("../state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => io.start) as never,
}));
vi.mock(import("@t3tools/client-runtime/state/runtime"), async (original) => ({
  ...(await original()),
  squashAtomCommandFailure: (() => new Error("Resource monitor is unavailable")) as never,
}));
vi.mock(import("../rightPanelStore"), async (original) => ({
  ...(await original()),
  useRightPanelStore: { getState: () => ({ closeAllSurfaces: io.closeTools }) } as never,
}));
vi.mock(import("../terminalUiStateStore"), async (original) => ({
  ...(await original()),
  useTerminalUiStateStore: { getState: () => ({ clearTerminalUiState: io.closeTools }) } as never,
}));
vi.mock(import("../previewMiniPlayerStore"), async (original) => ({
  ...(await original()),
  usePreviewMiniPlayerStore: { getState: () => ({ close: io.closeTools }) } as never,
}));
vi.mock(import("../localApi"), async (original) => ({
  ...(await original()),
  readLocalApi: () => undefined,
}));

const target = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") };

/** Resets the shared mocks; disposing settles any cleanup request the test left open. */
function setup(): Disposable {
  io.stream = { _tag: "Initial" };
  io.start.mockReset();
  io.closeTools.mockReset();
  return { [Symbol.dispose]: () => getCleanupRequest()?.done(false) };
}

function request(status: ThreadCleanupSnapshot["status"]) {
  io.start.mockResolvedValue({
    _tag: "Success",
    value: { operationId: "operation", threadId: target.threadId, status, resources: [] },
  });
  return requestThreadCleanup(target, false);
}

const dialog = () => page.getByRole("dialog");
const closeButton = () => page.getByRole("button", { name: "Close" });

it("dismisses a failed cleanup with Escape without resolving or closing tools, and can reopen", async () => {
  using _request = setup();
  const result = request("failed");
  await using _screen = await render(<ThreadCleanupDialog />);
  await expect.element(closeButton()).toBeVisible();

  await userEvent.keyboard("{Escape}");
  await expect.element(dialog()).not.toBeInTheDocument();
  expect(await result).toBe(false);
  expect(io.closeTools).not.toHaveBeenCalled();

  request("failed");
  await expect.element(dialog()).toBeVisible();
  expect(io.start).toHaveBeenCalledTimes(2);
});

it("keeps active cleanup open on Escape", async () => {
  using _request = setup();
  request("closing");
  await using _screen = await render(<ThreadCleanupDialog />);
  await expect.element(dialog()).toBeVisible();
  await vi.waitFor(() => expect(io.start).toHaveBeenCalledOnce());

  await userEvent.keyboard("{Escape}");
  await expect.element(dialog()).toBeVisible();
  await expect.element(closeButton()).not.toBeInTheDocument();
  expect(getCleanupRequest()).not.toBeNull();
});

it("allows dismissing a start error with the Close button", async () => {
  using _request = setup();
  io.start.mockResolvedValue({ _tag: "Failure" });
  const result = requestThreadCleanup(target, false);
  await using _screen = await render(<ThreadCleanupDialog />);
  await expect.element(page.getByRole("alert")).toMatchTextContent("Resource monitor");

  await closeButton().click();
  await expect.element(dialog()).not.toBeInTheDocument();
  expect(await result).toBe(false);
});

it("protects cleanup again while retry is pending", async () => {
  using _request = setup();
  request("failed");
  await using _screen = await render(<ThreadCleanupDialog />);
  await expect.element(page.getByRole("button", { name: "Retry" })).toBeVisible();
  io.start.mockReturnValue(new Promise(() => {}));

  await page.getByRole("button", { name: "Retry" }).click();
  await expect.element(closeButton()).not.toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog()).toBeVisible();
  await expect.element(closeButton()).not.toBeInTheDocument();
});

it("allows Escape after a connection failure without claiming server cleanup completed", async () => {
  using _request = setup();
  io.stream = { _tag: "Failure" };
  const result = request("closing");
  await using _screen = await render(<ThreadCleanupDialog />);
  await expect.element(closeButton()).toBeVisible();

  await userEvent.keyboard("{Escape}");
  await expect.element(dialog()).not.toBeInTheDocument();
  expect(await result).toBe(false);
  expect(io.closeTools).not.toHaveBeenCalled();
});

it("automatically dismisses successful cleanup and resolves the request", async () => {
  using _request = setup();
  const result = request("complete");
  // Installed before mounting: the start request completes during the first render.
  using _timers = fakeTimers();
  await using _screen = await render(<ThreadCleanupDialog />);
  await expect.element(dialog()).toMatchTextContent("Chat resolved");

  await act(() => vi.advanceTimersByTimeAsync(350));
  await expect.element(dialog()).not.toBeInTheDocument();
  expect(await result).toBe(true);
  expect(io.closeTools).toHaveBeenCalledTimes(3);
});

it("shows an absent browser as not applicable while another resource needs retry", async () => {
  using _request = setup();
  io.start.mockResolvedValue({
    _tag: "Success",
    value: {
      operationId: "operation",
      threadId: target.threadId,
      status: "failed",
      resources: [
        {
          id: "browser:stale",
          kind: "browser",
          label: "http://localhost:3011",
          status: "closed",
          notApplicable: true,
        },
        {
          id: "process:1",
          kind: "process",
          label: "dev server",
          status: "failed",
          error: "Process still running",
        },
      ],
    },
  });
  requestThreadCleanup(target, false);
  await using _screen = await render(<ThreadCleanupDialog />);
  await expect.element(page.getByLabelText("Not applicable")).toHaveTextContent("-");
  await expect.element(page.getByLabelText("Closing")).not.toBeInTheDocument();
  await expect.element(dialog()).not.toMatchTextContent("Reconnect the browser");
  await expect.element(page.getByRole("button", { name: "Retry" })).toBeVisible();
});
