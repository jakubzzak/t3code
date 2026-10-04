// @vitest-environment jsdom

import { EnvironmentId, ThreadId, type ThreadCleanupSnapshot } from "@t3tools/contracts";
import {
  getCleanupRequest,
  requestThreadCleanup,
} from "@t3tools/client-runtime/state/thread-cleanup";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { ThreadCleanupDialog } from "./ThreadCleanupDialog";

const io = vi.hoisted(() => ({
  start: vi.fn(),
  stream: { _tag: "Initial" } as { _tag: string; value?: ThreadCleanupSnapshot },
  closeTools: vi.fn(),
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => io.stream }));
vi.mock("../state/threads", () => ({
  threadEnvironment: { cleanupState: () => null, cleanupStart: null },
}));
vi.mock("../state/use-atom-command", () => ({ useAtomCommand: () => io.start }));
vi.mock("@t3tools/client-runtime/state/runtime", () => ({
  squashAtomCommandFailure: () => new Error("Resource monitor is unavailable"),
}));
vi.mock("../rightPanelStore", () => ({
  useRightPanelStore: { getState: () => ({ closeAllSurfaces: io.closeTools }) },
}));
vi.mock("../terminalUiStateStore", () => ({
  useTerminalUiStateStore: { getState: () => ({ clearTerminalUiState: io.closeTools }) },
}));
vi.mock("../previewMiniPlayerStore", () => ({
  usePreviewMiniPlayerStore: { getState: () => ({ close: io.closeTools }) },
}));
vi.mock("../localApi", () => ({ readLocalApi: () => undefined }));

const target = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("thread") };
let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  io.stream = { _tag: "Initial" };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
    getCleanupRequest()?.done(false);
  });
  container.remove();
  vi.unstubAllGlobals();
});

async function open(status: ThreadCleanupSnapshot["status"]) {
  io.start.mockResolvedValue({
    _tag: "Success",
    value: { operationId: "operation", threadId: target.threadId, status, resources: [] },
  });
  const result = requestThreadCleanup(target, false);
  await act(async () => root.render(<ThreadCleanupDialog />));
  return { result };
}

async function escape() {
  await act(async () => {
    (document.activeElement ?? document.body).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
}

it("dismisses a failed cleanup with Escape without resolving or closing tools, and can reopen", async () => {
  const { result } = await open("failed");
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await escape();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(await result).toBe(false);
  expect(io.closeTools).not.toHaveBeenCalled();
  await open("failed");
  expect(io.start).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});

it("keeps active cleanup open on Escape", async () => {
  await open("closing");
  await escape();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Close"]')).toBeNull();
  expect(getCleanupRequest()).not.toBeNull();
});

it("allows dismissing a start error with the Close button", async () => {
  io.start.mockResolvedValue({ _tag: "Failure" });
  const result = requestThreadCleanup(target, false);
  await act(async () => root.render(<ThreadCleanupDialog />));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Resource monitor");
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close"]')!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(await result).toBe(false);
});

it("protects cleanup again while retry is pending", async () => {
  await open("failed");
  io.start.mockReturnValue(new Promise(() => {}));
  await act(async () => {
    [...document.querySelectorAll("button")]
      .find((button) => button.textContent === "Retry")!
      .click();
  });
  await escape();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Close"]')).toBeNull();
});

it("allows Escape after a connection failure without claiming server cleanup completed", async () => {
  io.stream = { _tag: "Failure" };
  const { result } = await open("closing");
  await escape();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(await result).toBe(false);
  expect(io.closeTools).not.toHaveBeenCalled();
});

it("automatically dismisses successful cleanup and resolves the request", async () => {
  vi.useFakeTimers();
  try {
    const { result } = await open("complete");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Chat resolved");
    await act(async () => vi.advanceTimersByTimeAsync(350));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(await result).toBe(true);
    expect(io.closeTools).toHaveBeenCalledTimes(3);
  } finally {
    vi.useRealTimers();
  }
});
