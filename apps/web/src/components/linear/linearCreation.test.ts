// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import { beginLinearCreation, useLinearCreations } from "./linearCreation";

const bridge = vi.hoisted(() => ({
  status: vi.fn(),
  waitFor: vi.fn(),
  press: vi.fn(),
  evaluate: vi.fn(),
}));
vi.mock("../preview/previewBridge", () => ({ previewBridge: { automation: bridge } }));
const issue = {
  id: "created-issue",
  identifier: "ENG-1",
  title: "New work",
  workspace: "acme",
  url: "https://linear.app/acme/issue/ENG-1",
  branchName: "eng-1-new-work",
};
const request = vi.fn();
const created = vi.fn();
const readResult = vi.fn();
const ready = { available: true, loading: false, url: "https://linear.app/acme/my-issues" };
const key = "origin";
const start = () =>
  beginLinearCreation({
    key,
    workspace: "acme",
    connectionKey: "env/project",
    open: async () => "runtime-origin",
    onCreated: created,
  });
const interrupted = (operation = "evaluate") =>
  new Error(
    `Error invoking remote method: PreviewAutomationControlInterruptedError: Preview automation ${operation} was interrupted by human input in tab runtime-origin`,
  );
beforeEach(() => {
  vi.useFakeTimers();
  bridge.status.mockResolvedValue(ready);
  bridge.waitFor.mockResolvedValue(undefined);
  bridge.press.mockResolvedValue(undefined);
  bridge.evaluate.mockImplementation(async (_id, input: { expression: string }) => {
    if (input.expression.includes("return task?.token")) return readResult();
    return true;
  });
  readResult.mockResolvedValue({ status: "created", issueId: issue.id });
  request.mockResolvedValue({ issues: [issue] });
  Object.assign(window, { desktopBridge: { linearRequest: request } });
});
afterEach(() => {
  useLinearCreations.setState({ entries: {} });
  vi.resetAllMocks();
  vi.useRealTimers();
  Object.assign(window, { desktopBridge: undefined });
});

it("waits for a delayed native guest and initial navigation before opening the editor", async () => {
  bridge.status
    .mockResolvedValueOnce({ ...ready, available: false })
    .mockResolvedValueOnce({ ...ready, url: "about:blank" })
    .mockResolvedValueOnce({ ...ready, loading: true });
  const completion = start();
  await vi.advanceTimersByTimeAsync(500);
  expect(bridge.waitFor).not.toHaveBeenCalled();
  expect(bridge.press).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(250);
  await completion;
  expect(created).toHaveBeenCalledExactlyOnceWith(issue);
  expect(bridge.press).toHaveBeenCalledExactlyOnceWith("runtime-origin", { key: "c" });
});

it("bounds the wait when a guest never becomes available", async () => {
  bridge.status.mockResolvedValue({ ...ready, available: false });
  const completion = start();
  await vi.advanceTimersByTimeAsync(60_000);
  await completion;
  expect(useLinearCreations.getState().entries[key]?.error).toContain("panel is not ready");
  expect(bridge.press).not.toHaveBeenCalled();
  expect(created).not.toHaveBeenCalled();
});

it("keeps tracking after human input interrupts completion reads without replaying editor input", async () => {
  readResult.mockRejectedValueOnce(interrupted()).mockRejectedValueOnce(interrupted());
  const completion = start();
  await vi.advanceTimersByTimeAsync(250);
  expect(useLinearCreations.getState().entries[key]?.status).toBe("pending");
  expect(
    bridge.evaluate.mock.calls.some(([, input]) => input.expression.includes("task.cancel()")),
  ).toBe(false);
  await vi.advanceTimersByTimeAsync(250);
  await completion;
  expect(created).toHaveBeenCalledExactlyOnceWith(issue);
  expect(request).toHaveBeenCalledExactlyOnceWith({
    operation: "issue",
    workspace: "acme",
    connectionKey: "env/project",
    issueId: issue.id,
  });
  expect(bridge.press).toHaveBeenCalledTimes(1);
});

it("allows human input while waiting for the editor without repeating the opening shortcut", async () => {
  bridge.waitFor.mockResolvedValueOnce(undefined).mockRejectedValueOnce(interrupted("waitFor"));
  const completion = start();
  await vi.advanceTimersByTimeAsync(250);
  await completion;
  expect(created).toHaveBeenCalledExactlyOnceWith(issue);
  expect(bridge.press).toHaveBeenCalledTimes(1);
});

it("does not retry an interrupted opening keystroke", async () => {
  bridge.press.mockRejectedValue(interrupted("press"));
  await start();
  expect(bridge.press).toHaveBeenCalledTimes(1);
  expect(useLinearCreations.getState().entries[key]?.status).toBe("error");
  expect(created).not.toHaveBeenCalled();
});

it("still honors cancellation after an interrupted completion read", async () => {
  readResult.mockRejectedValueOnce(interrupted()).mockResolvedValueOnce({ status: "cancelled" });
  const completion = start();
  await vi.advanceTimersByTimeAsync(250);
  await completion;
  expect(useLinearCreations.getState().entries[key]).toBeUndefined();
  expect(request).not.toHaveBeenCalled();
  expect(created).not.toHaveBeenCalled();
});

it("fails closed when navigation replaces the tracked document after an interruption", async () => {
  readResult.mockRejectedValueOnce(interrupted()).mockResolvedValueOnce(null);
  const completion = start();
  await vi.advanceTimersByTimeAsync(250);
  await completion;
  expect(useLinearCreations.getState().entries[key]?.error).toContain("navigated away");
  expect(created).not.toHaveBeenCalled();
});

it("does not hide other failures or retry them as human input", async () => {
  readResult.mockRejectedValue(new Error("PreviewWebContentsNotFoundError"));
  await start();
  expect(readResult).toHaveBeenCalledTimes(1);
  expect(useLinearCreations.getState().entries[key]?.error).toBe("PreviewWebContentsNotFoundError");
  expect(created).not.toHaveBeenCalled();
});

it("bounds repeated human interruptions instead of waiting forever", async () => {
  readResult.mockRejectedValue(interrupted());
  const completion = start();
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  await completion;
  expect(useLinearCreations.getState().entries[key]?.error).toContain("timed out");
  expect(bridge.press).toHaveBeenCalledTimes(1);
  expect(created).not.toHaveBeenCalled();
});
