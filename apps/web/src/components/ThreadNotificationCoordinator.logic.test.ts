import { MessageId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  type AutomationFailureNotice,
  createAutomationFailureNotices,
  createThreadNotificationGate,
  isSnoozedForNotification,
  RELEASED_COMPLETION_GRACE_MS,
  type ThreadNotificationObservation,
  unreadAutomationFailure,
} from "./ThreadNotificationCoordinator.logic";

const working: ThreadNotificationObservation = {
  attention: null,
  requestId: null,
  settled: false,
  completedAt: null,
  backgroundWake: false,
};
const completed = (at: number): ThreadNotificationObservation => ({
  attention: null,
  requestId: null,
  settled: true,
  completedAt: at,
  backgroundWake: false,
});
const waking: ThreadNotificationObservation = { ...working, backgroundWake: true };
const woke = (at: number): ThreadNotificationObservation => ({
  ...completed(at),
  backgroundWake: true,
});
const visible = { archived: false, quiet: false, snoozed: false };
const snoozed = { ...visible, snoozed: true };

function fakeTimers(): Disposable {
  vi.useFakeTimers();
  return { [Symbol.dispose]: () => void vi.useRealTimers() };
}

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
  it("skips a completion seen while snoozed, but still notifies attention", () => {
    const { notify, observe } = harness();
    observe(working);
    observe(completed(1), snoozed);
    observe({ ...completed(1) });
    expect(notify).not.toHaveBeenCalled();
    observe({ ...working, attention: "run-2:approval" }, snoozed);
    expect(notify.mock.calls).toEqual([["thread", "input"]]);
  });

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

  it("notifies each attention once per stretch and still notifies the subsequent completion", () => {
    const { notify, observe } = harness();
    observe(working);
    const attention = { ...working, attention: "run-1:approval:a", requestId: "a" };
    observe(attention);
    expect(notify.mock.calls).toEqual([["thread", "input"]]);
    observe({ ...attention });
    expect(notify).toHaveBeenCalledTimes(1);
    observe({ ...attention, attention: "run-1:approval:b", requestId: "b" });
    observe(attention);
    expect(notify).toHaveBeenCalledTimes(2);
    observe(working);
    observe(attention);
    expect(notify).toHaveBeenCalledTimes(3);
    const subagent = { ...attention, attention: "run-1:approval:", requestId: null };
    observe(subagent);
    observe(attention);
    observe(subagent);
    expect(notify).toHaveBeenCalledTimes(5);
    observe(working);
    observe(completed(1));
    expect(notify.mock.calls).toEqual([
      ["thread", "input"],
      ["thread", "input"],
      ["thread", "input"],
      ["thread", "input"],
      ["thread", "input"],
      ["thread", "completion"],
    ]);
  });

  it("does not replay a completion after attention resolves", () => {
    const { notify, observe } = harness();
    observe(working);
    observe(completed(1));
    observe({ ...working, attention: "run-1:limited" });
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

  it("waits out the grace before notifying a wake's completion, and a final wake replaces it", () => {
    using _timers = fakeTimers();
    const { notify, observe } = harness();
    observe(working);
    observe(completed(1));
    // Held until the monitor left, or completing after it already had: either way unheld here.
    observe(waking);
    observe(woke(2));
    expect(notify).toHaveBeenCalledTimes(1);
    observe(working);
    vi.advanceTimersByTime(RELEASED_COMPLETION_GRACE_MS);
    expect(notify).toHaveBeenCalledTimes(1);
    observe(completed(3));
    vi.advanceTimersByTime(RELEASED_COMPLETION_GRACE_MS);
    expect(notify.mock.calls).toEqual([
      ["thread", "completion"],
      ["thread", "completion"],
    ]);
  });

  it("notifies a wake's completion once after the grace when no run follows, even across a pause", () => {
    using _timers = fakeTimers();
    const { gate, notify, observe } = harness();
    observe(waking);
    observe(woke(1));
    gate.pause();
    vi.advanceTimersByTime(RELEASED_COMPLETION_GRACE_MS);
    expect(notify).not.toHaveBeenCalled();
    observe({ ...woke(1) });
    vi.advanceTimersByTime(RELEASED_COMPLETION_GRACE_MS - 1);
    observe({ ...woke(1) });
    expect(notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(notify.mock.calls).toEqual([["thread", "completion"]]);
    observe({ ...woke(1) });
    vi.advanceTimersByTime(RELEASED_COMPLETION_GRACE_MS);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("drops a pending wake completion when the thread is snoozed", () => {
    using _timers = fakeTimers();
    const { notify, observe } = harness();
    observe(waking);
    observe(woke(1));
    observe({ ...woke(1) }, snoozed);
    vi.advanceTimersByTime(RELEASED_COMPLETION_GRACE_MS);
    expect(notify).not.toHaveBeenCalled();
  });

  it("drops a pending wake completion when the thread is removed or the gate is cleared", () => {
    using _timers = fakeTimers();
    for (const reset of [
      (gate: ReturnType<typeof createThreadNotificationGate<string>>) => gate.retain(new Set()),
      (gate: ReturnType<typeof createThreadNotificationGate<string>>) => gate.clear(),
    ]) {
      const { gate, notify, observe } = harness();
      observe(waking);
      observe(woke(1));
      reset(gate);
      vi.advanceTimersByTime(RELEASED_COMPLETION_GRACE_MS);
      expect(notify).not.toHaveBeenCalled();
    }
  });
});

describe("isSnoozedForNotification", () => {
  const snoozedAt = Date.parse("2026-01-01T11:00:00.000Z");
  const wakeAt = Date.parse("2026-01-01T12:00:00.000Z");
  const thread = {
    snoozedAt: new Date(snoozedAt).toISOString(),
    snoozedUntil: new Date(wakeAt).toISOString(),
    hasPendingApprovals: false,
    hasPendingUserInput: false,
  };
  const later = wakeAt + 60_000;

  it.each([
    ["during the snooze, processed after the wake", thread, wakeAt - 1, later, true],
    ["before the snooze, processed after the wake", thread, snoozedAt - 1, later, false],
    ["after the wake", thread, wakeAt + 1, later, false],
    [
      "after an early wake for attention",
      { ...thread, hasPendingApprovals: true },
      wakeAt - 1,
      wakeAt - 1,
      false,
    ],
  ])("a completion %s is suppressed: %s", (_name, shell, completedAt, now, expected) => {
    expect(isSnoozedForNotification(shell, completedAt, now)).toBe(expected);
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

  it.each(["read, snoozed or settled", "opened"])(
    "closes the notice once the chat is %s",
    (way) => {
      const { close, notices } = harness();
      notices.shown("thread-1", failure, "toast-1");
      notices.observe("thread-1", failure, way === "opened" ? failure : null, way === "opened");
      expect(close).toHaveBeenCalledWith("toast-1");
    },
  );

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
