import { expect, it, vi } from "vite-plus/test";

import { fakeTimers, stubGlobal } from "../../../test/render";
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
const ready = { available: true, loading: false, url: "https://linear.app/acme/my-issues" };
const key = "origin";
const interrupted = (operation = "evaluate") =>
  new Error(
    `Error invoking remote method: PreviewAutomationControlInterruptedError: Preview automation ${operation} was interrupted by human input in tab runtime-origin`,
  );

/** Resets the shared bridge mocks and installs the desktop bridge; dispose clears creations. */
function setup() {
  using stack = new DisposableStack();
  const request = vi.fn();
  const created = vi.fn();
  const readResult = vi.fn();
  for (const mock of Object.values(bridge)) mock.mockReset();
  bridge.status.mockResolvedValue(ready);
  bridge.waitFor.mockResolvedValue(undefined);
  bridge.press.mockResolvedValue(undefined);
  bridge.evaluate.mockImplementation(async (_id, input: { expression: string }) => {
    if (input.expression.includes("return task?.token")) return readResult();
    return true;
  });
  readResult.mockResolvedValue({ status: "created", issueId: issue.id });
  request.mockResolvedValue({ issues: [issue] });
  stack.use(stubGlobal("desktopBridge", { linearRequest: request }));
  stack.defer(() => useLinearCreations.setState({ entries: {} }));
  const start = () =>
    beginLinearCreation({
      key,
      workspace: "acme",
      connectionKey: '["env","project"]',
      open: async () => "runtime-origin",
      onCreated: created,
    });
  const resources = stack.move();
  return {
    request,
    created,
    readResult,
    start,
    [Symbol.dispose]: () => resources.dispose(),
  };
}

it("waits for a delayed native guest and initial navigation before opening the editor", async () => {
  using _timers = fakeTimers();
  using t = setup();
  bridge.status
    .mockResolvedValueOnce({ ...ready, available: false })
    .mockResolvedValueOnce({ ...ready, url: "about:blank" })
    .mockResolvedValueOnce({ ...ready, loading: true });
  const completion = t.start();
  await vi.advanceTimersByTimeAsync(500);
  expect(bridge.waitFor).not.toHaveBeenCalled();
  expect(bridge.press).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(250);
  await completion;
  expect(t.created).toHaveBeenCalledExactlyOnceWith(issue);
  expect(bridge.press).toHaveBeenCalledExactlyOnceWith("runtime-origin", { key: "c" });
});

it("bounds the wait when a guest never becomes available", async () => {
  using _timers = fakeTimers();
  using t = setup();
  bridge.status.mockResolvedValue({ ...ready, available: false });
  const completion = t.start();
  await vi.advanceTimersByTimeAsync(60_000);
  await completion;
  expect(useLinearCreations.getState().entries[key]?.error).toContain("panel is not ready");
  expect(bridge.press).not.toHaveBeenCalled();
  expect(t.created).not.toHaveBeenCalled();
});

it("keeps tracking after human input interrupts completion reads without replaying editor input", async () => {
  using _timers = fakeTimers();
  using t = setup();
  t.readResult.mockRejectedValueOnce(interrupted()).mockRejectedValueOnce(interrupted());
  const completion = t.start();
  await vi.advanceTimersByTimeAsync(250);
  expect(useLinearCreations.getState().entries[key]?.status).toBe("pending");
  expect(
    bridge.evaluate.mock.calls.some(([, input]) => input.expression.includes("task.cancel()")),
  ).toBe(false);
  await vi.advanceTimersByTimeAsync(250);
  await completion;
  expect(t.created).toHaveBeenCalledExactlyOnceWith(issue);
  expect(t.request).toHaveBeenCalledExactlyOnceWith({
    operation: "issue",
    workspace: "acme",
    connectionKey: '["env","project"]',
    issueId: issue.id,
  });
  expect(bridge.press).toHaveBeenCalledTimes(1);
});

it("allows human input while waiting for the editor without repeating the opening shortcut", async () => {
  using _timers = fakeTimers();
  using t = setup();
  bridge.waitFor.mockResolvedValueOnce(undefined).mockRejectedValueOnce(interrupted("waitFor"));
  const completion = t.start();
  await vi.advanceTimersByTimeAsync(250);
  await completion;
  expect(t.created).toHaveBeenCalledExactlyOnceWith(issue);
  expect(bridge.press).toHaveBeenCalledTimes(1);
});

it("does not retry an interrupted opening keystroke", async () => {
  using _timers = fakeTimers();
  using t = setup();
  bridge.press.mockRejectedValue(interrupted("press"));
  await t.start();
  expect(bridge.press).toHaveBeenCalledTimes(1);
  expect(useLinearCreations.getState().entries[key]?.status).toBe("error");
  expect(t.created).not.toHaveBeenCalled();
});

it("still honors cancellation after an interrupted completion read", async () => {
  using _timers = fakeTimers();
  using t = setup();
  t.readResult.mockRejectedValueOnce(interrupted()).mockResolvedValueOnce({ status: "cancelled" });
  const completion = t.start();
  await vi.advanceTimersByTimeAsync(250);
  await completion;
  expect(useLinearCreations.getState().entries[key]).toBeUndefined();
  expect(t.request).not.toHaveBeenCalled();
  expect(t.created).not.toHaveBeenCalled();
});

it("fails closed when navigation replaces the tracked document after an interruption", async () => {
  using _timers = fakeTimers();
  using t = setup();
  t.readResult.mockRejectedValueOnce(interrupted()).mockResolvedValueOnce(null);
  const completion = t.start();
  await vi.advanceTimersByTimeAsync(250);
  await completion;
  expect(useLinearCreations.getState().entries[key]?.error).toContain("navigated away");
  expect(t.created).not.toHaveBeenCalled();
});

it("does not hide other failures or retry them as human input", async () => {
  using _timers = fakeTimers();
  using t = setup();
  t.readResult.mockRejectedValue(new Error("PreviewWebContentsNotFoundError"));
  await t.start();
  expect(t.readResult).toHaveBeenCalledTimes(1);
  expect(useLinearCreations.getState().entries[key]?.error).toBe("PreviewWebContentsNotFoundError");
  expect(t.created).not.toHaveBeenCalled();
});

it("bounds repeated human interruptions instead of waiting forever", async () => {
  using _timers = fakeTimers();
  using t = setup();
  t.readResult.mockRejectedValue(interrupted());
  const completion = t.start();
  await vi.advanceTimersByTimeAsync(1_000);
  expect(useLinearCreations.getState().entries[key]?.status).toBe("pending");
  // Each fake timer yields a real macrotask in the browser, so stepping through all 3,600
  // retries outlasts the test timeout. Jump the clock past the deadline instead.
  vi.setSystemTime(Date.now() + 15 * 60_000);
  await vi.advanceTimersByTimeAsync(250);
  await completion;
  expect(useLinearCreations.getState().entries[key]?.error).toContain("timed out");
  expect(bridge.press).toHaveBeenCalledTimes(1);
  expect(t.created).not.toHaveBeenCalled();
});
