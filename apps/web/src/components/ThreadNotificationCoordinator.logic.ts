import type { OrchestrationV2ThreadShell } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export type ThreadNotificationKind = "input" | "completion";

export interface ThreadNotificationObservation {
  /** Run and status key while the thread needs attention, otherwise null. */
  readonly attention: string | null;
  /** The thread is idle and its latest run completed. */
  readonly settled: boolean;
  /** When the latest run completed, if it did. */
  readonly completedAt: number | null;
}

export function createThreadNotificationGate<Key>(
  notify: (key: Key, kind: ThreadNotificationKind) => void,
) {
  // The newest completion already notified, or deliberately skipped.
  const handled = new Map<Key, number>();
  const skip = (key: Key, at: number | null) => {
    if (at !== null && at > (handled.get(key) ?? -Infinity)) handled.set(key, at);
  };
  return {
    observe(
      key: Key,
      prior: ThreadNotificationObservation | undefined,
      next: ThreadNotificationObservation,
      options: { readonly archived: boolean; readonly quiet: boolean },
    ): void {
      // The first sighting, archived threads, and stopped or silent runs never notify completion.
      if (!prior || options.archived || options.quiet) skip(key, next.completedAt);
      if (!prior || options.archived) return;
      if (next.attention && next.attention !== prior.attention) {
        notify(key, "input");
        return;
      }
      const at = next.completedAt;
      if (!next.settled || at === null || at <= (handled.get(key) ?? -Infinity)) return;
      handled.set(key, at);
      notify(key, "completion");
    },
    /** Forgets threads that left the snapshot. */
    retain(keys: ReadonlySet<Key>): void {
      for (const key of handled.keys()) if (!keys.has(key)) handled.delete(key);
    },
    clear(): void {
      handled.clear();
    },
  };
}

export type AutomationFailureNotice = NonNullable<
  OrchestrationV2ThreadShell["lastAutomationFailure"]
>;

/** A failed automation run the user has not read and has not snoozed, settled or archived. */
export function unreadAutomationFailure(
  thread: Pick<
    OrchestrationV2ThreadShell,
    | "status"
    | "archivedAt"
    | "settledOverride"
    | "snoozedUntil"
    | "lastVisitedAt"
    | "lastAutomationFailure"
  >,
  now: number,
): AutomationFailureNotice | null {
  const failure = thread.lastAutomationFailure;
  if (
    !failure ||
    thread.status !== "failed" ||
    thread.archivedAt !== null ||
    thread.settledOverride === "settled"
  )
    return null;
  if (thread.snoozedUntil != null && DateTime.toEpochMillis(thread.snoozedUntil) > now) return null;
  if (
    thread.lastVisitedAt != null &&
    Date.parse(failure.occurredAt) <= DateTime.toEpochMillis(thread.lastVisitedAt)
  )
    return null;
  return failure;
}

/**
 * Tracks which automation failures were already shown or seen, so each one notifies once per
 * failure across reconnects, and closes a notice once its failure is read or no longer unread.
 * A failure that could not be shown stays pending and is offered again on the next observation.
 */
export function createAutomationFailureNotices<Key, Handle>(close: (handle: Handle) => void) {
  const notified = new Map<Key, string>();
  const open = new Map<Key, Handle>();
  const closeOpen = (key: Key) => {
    const handle = open.get(key);
    if (handle === undefined) return;
    open.delete(key);
    close(handle);
  };
  return {
    /** Returns the failure to present now, if any. */
    observe(
      key: Key,
      failure: AutomationFailureNotice | null | undefined,
      unread: AutomationFailureNotice | null,
      viewing: boolean,
    ): AutomationFailureNotice | null {
      if (failure && viewing) notified.set(key, failure.messageId);
      if (!unread || viewing) closeOpen(key);
      return unread && notified.get(key) !== unread.messageId ? unread : null;
    },
    /** Records a presented failure; a toast handle replaces the thread's previous notice. */
    shown(key: Key, failure: AutomationFailureNotice, handle?: Handle): void {
      if (handle !== undefined) {
        closeOpen(key);
        open.set(key, handle);
      }
      notified.set(key, failure.messageId);
    },
    /** Drops a notice that closed on its own. */
    forget(key: Key, handle: Handle): void {
      if (open.get(key) === handle) open.delete(key);
    },
    /** Closes notices for threads that left the snapshot. */
    retain(keys: ReadonlySet<Key>): void {
      for (const key of Array.from(open.keys())) if (!keys.has(key)) closeOpen(key);
    },
    clear(): void {
      for (const key of Array.from(open.keys())) closeOpen(key);
    },
  };
}
