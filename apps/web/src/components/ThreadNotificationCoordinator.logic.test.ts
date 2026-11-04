import { MessageId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  type AutomationFailureNotice,
  createAutomationFailureNotices,
  createThreadNotificationGate,
  type ThreadNotificationObservation,
  unreadAutomationFailure,
} from "./ThreadNotificationCoordinator.logic";

const working: ThreadNotificationObservation = {
  attention: null,
  settled: false,
  completedAt: null,
};
const completed = (at: number): ThreadNotificationObservation => ({
  attention: null,
  settled: true,
  completedAt: at,
});
const visible = { archived: false, quiet: false };

function harness() {
  const notify = vi.fn();
  const gate = createThreadNotificationGate<string>(notify);
  let prior: ThreadNotificationObservation | undefined;
  const observe = (next: ThreadNotificationObservation, options = visible) => {
    gate.observe("thread", prior, next, options);
    prior = next;
  };
  return { gate, notify, observe };
}

describe("createThreadNotificationGate", () => {
  it("notifies a completion immediately and only once", () => {
    const { notify, observe } = harness();
    observe(working);
    observe(completed(1));
    expect(notify.mock.calls).toEqual([["thread", "completion"]]);
    observe({ ...completed(1) });
    observe(working);
    observe(completed(1));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("notifies each newer completion immediately", () => {
    const { notify, observe } = harness();
    observe(working);
    observe(completed(1));
    observe(working);
    observe(completed(2));
    expect(notify.mock.calls).toEqual([
      ["thread", "completion"],
      ["thread", "completion"],
    ]);
    observe(completed(1));
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("notifies attention once and still notifies the subsequent completion", () => {
    const { notify, observe } = harness();
    observe(working);
    const attention = { attention: "run-1:approval", settled: false, completedAt: null };
    observe(attention);
    expect(notify.mock.calls).toEqual([["thread", "input"]]);
    observe({ ...attention });
    expect(notify).toHaveBeenCalledTimes(1);
    observe(working);
    observe(completed(1));
    expect(notify.mock.calls).toEqual([
      ["thread", "input"],
      ["thread", "completion"],
    ]);
  });

  it("does not replay a completion after attention resolves", () => {
    const { notify, observe } = harness();
    observe(working);
    observe(completed(1));
    observe({ attention: "run-1:limited", settled: false, completedAt: null });
    observe(completed(1));
    expect(notify.mock.calls).toEqual([
      ["thread", "completion"],
      ["thread", "input"],
    ]);
  });

  it("never notifies existing, archived or stopped completions, including when unarchived", () => {
    const { notify, observe } = harness();
    observe(completed(1));
    observe(working);
    observe(completed(2), { ...visible, quiet: true });
    observe(completed(2));
    observe(working);
    observe(completed(3), { ...visible, archived: true });
    observe(completed(3));
    expect(notify).not.toHaveBeenCalled();
    observe(working);
    observe(completed(4));
    expect(notify.mock.calls).toEqual([["thread", "completion"]]);
  });

  it("forgets handled completions when a thread is removed or the gate is cleared", () => {
    for (const reset of [
      (gate: ReturnType<typeof createThreadNotificationGate<string>>) => gate.retain(new Set()),
      (gate: ReturnType<typeof createThreadNotificationGate<string>>) => gate.clear(),
    ]) {
      const { gate, notify, observe } = harness();
      observe(completed(1));
      reset(gate);
      gate.observe("thread", undefined, working, visible);
      gate.observe("thread", working, completed(1), visible);
      expect(notify.mock.calls).toEqual([["thread", "completion"]]);
    }
  });
});

const failure: AutomationFailureNotice = {
  messageId: MessageId.make("failed-automation-message"),
  message: "Joel is disabled. Enable it and use Run now to retry.",
  occurredAt: "2026-09-13T10:00:00.000Z",
};
const NOW = Date.parse("2026-09-13T12:00:00.000Z");
const failedThread = {
  status: "failed" as const,
  archivedAt: null,
  settledOverride: null,
  snoozedUntil: null,
  lastVisitedAt: null,
  lastAutomationFailure: failure,
};

describe("unreadAutomationFailure", () => {
  it("reports a failed automation the user has not read", () => {
    expect(unreadAutomationFailure(failedThread, NOW)).toBe(failure);
  });

  it.each([
    ["read after it failed", { lastVisitedAt: DateTime.makeUnsafe("2026-09-13T11:00:00.000Z") }],
    ["snoozed", { snoozedUntil: DateTime.makeUnsafe("2099-01-01T00:00:00.000Z") }],
    ["settled", { settledOverride: "settled" as const }],
    ["archived", { archivedAt: DateTime.makeUnsafe("2026-09-13T11:00:00.000Z") }],
    ["no longer failed", { status: "idle" as const }],
  ])("ignores a failure once %s", (_label, change) => {
    expect(unreadAutomationFailure({ ...failedThread, ...change }, NOW)).toBeNull();
  });

  it("reports it again once a snooze has expired", () => {
    const snoozedUntil = DateTime.makeUnsafe("2026-09-13T11:00:00.000Z");
    expect(unreadAutomationFailure({ ...failedThread, snoozedUntil }, NOW)).toBe(failure);
  });
});

describe("createAutomationFailureNotices", () => {
  function harness() {
    const close = vi.fn();
    const notices = createAutomationFailureNotices<string, string>(close);
    return { close, notices };
  }

  it("offers an unread failure until it is shown, then never again", () => {
    const { notices } = harness();
    // Not shown while the app was in the background: still pending.
    expect(notices.observe("thread-1", failure, failure, false)).toBe(failure);
    expect(notices.observe("thread-1", failure, failure, false)).toBe(failure);
    notices.shown("thread-1", failure, "toast-1");
    // Reconnects and later observations do not replay it.
    expect(notices.observe("thread-1", failure, failure, false)).toBeNull();
  });

  it("treats a failure seen in its open chat as notified", () => {
    const { notices } = harness();
    expect(notices.observe("thread-1", failure, failure, true)).toBeNull();
    expect(notices.observe("thread-1", failure, failure, false)).toBeNull();
  });

  it.each(["read, snoozed or settled", "opened"])("closes the notice once the chat is %s", (way) => {
    const { close, notices } = harness();
    notices.shown("thread-1", failure, "toast-1");
    notices.observe("thread-1", failure, way === "opened" ? failure : null, way === "opened");
    expect(close).toHaveBeenCalledWith("toast-1");
  });

  it("keeps notices for different chats independent", () => {
    const { close, notices } = harness();
    notices.shown("thread-1", failure, "toast-1");
    expect(notices.observe("thread-2", failure, failure, false)).toBe(failure);
    notices.shown("thread-2", failure, "toast-2");
    expect(close).not.toHaveBeenCalled();
    notices.retain(new Set(["thread-2"]));
    expect(close.mock.calls).toEqual([["toast-1"]]);
  });

  it("does not close a notice that already closed on its own", () => {
    const { close, notices } = harness();
    notices.shown("thread-1", failure, "toast-1");
    notices.forget("thread-1", "toast-1");
    notices.clear();
    expect(close).not.toHaveBeenCalled();
  });
});
