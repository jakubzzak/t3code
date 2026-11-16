import {
  type EnvironmentThreadShell,
  type PendingSubagentRequest,
  presentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { isShownUnderParent } from "@t3tools/client-runtime/state/threads";
import type { AnyRouter } from "@tanstack/react-router";
import { parseThreadKey, threadKey } from "@t3tools/client-runtime/state/entities";
import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import { monitorHoldsWakeCompletion } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import type { ClientSettings } from "@t3tools/contracts/settings";
import * as Option from "effect/Option";
import type { AtomRegistry } from "effect/reactivity";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";

import { getClientSettings, subscribeClientSettings } from "../hooks/useSettings";
import { isWindowsPlatform } from "../lib/utils";
import { environmentSummaries } from "../state/presentation";
import { environmentShell } from "../state/shell";
import { environmentThreadShells } from "../state/threads";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
  setNotificationBadge,
  threadNotificationTag,
  unlockNotificationAudio,
} from "../threadNotifications";
import { resolveBackgroundThreadRequest } from "./backgroundThreadAnnouncement";
import { resolveSidebarThreadStatus, type SidebarThreadStatus } from "./Sidebar.logic";
import {
  type AutomationFailureNotice,
  createAutomationFailureNotices,
  createThreadNotificationGate,
  isSnoozedForNotification,
  type ThreadNotificationKind,
  type ThreadNotificationObservation,
  unreadAutomationFailure,
} from "./ThreadNotificationCoordinator.logic";
import { toastManager } from "./ui/toast";

interface NotificationState extends ThreadNotificationObservation {
  readonly raw: OrchestrationV2ThreadShell;
  readonly subagentRequest: PendingSubagentRequest | null;
  readonly thread: EnvironmentThreadShell;
  readonly status: SidebarThreadStatus;
  /** An unread automation failure to present in place of this pass's routine notification. */
  readonly automationFailure: AutomationFailureNotice | null;
}

type ToastId = ReturnType<typeof toastManager.add>;

interface WatchedEnvironment {
  unsubscribe: () => void;
  reobserve: () => void;
  previous: Map<ThreadId, NotificationState>;
  reconnecting: boolean;
  readonly gate: ReturnType<typeof createThreadNotificationGate<ThreadId>>;
  readonly automationFailures: ReturnType<typeof createAutomationFailureNotices<ThreadId, ToastId>>;
}

function notificationIcon(kind: ThreadNotificationKind, status: SidebarThreadStatus) {
  return kind === "completion" ? (
    <CircleCheckIcon aria-hidden className="size-4 text-success-foreground" />
  ) : status === "approval" ? (
    <ShieldQuestionIcon aria-hidden className="size-4 text-warning-foreground" />
  ) : status === "limited" ? (
    <CircleAlertIcon aria-hidden className="size-4 text-warning-foreground" />
  ) : status === "failed" ? (
    <CircleAlertIcon aria-hidden className="size-4 text-destructive-foreground" />
  ) : (
    <MessageCircleQuestionIcon aria-hidden className="size-4 text-info-foreground" />
  );
}

/**
 * Turns thread status transitions in every connected environment into sounds, in-app toasts,
 * and desktop notifications, and keeps the dock badge in step with the unread ones.
 */
export function startThreadNotifications(
  registry: AtomRegistry.AtomRegistry,
  router: AnyRouter,
): () => void {
  const pending = new Map<
    string,
    { environmentId: EnvironmentId; threadId: ThreadId; notification: Notification }
  >();
  const watched = new Map<EnvironmentId, WatchedEnvironment>();

  const trackNotification = (
    environmentId: EnvironmentId,
    threadId: ThreadId,
    notification: Notification,
  ) => {
    pending.get(notification.tag)?.notification.close();
    pending.set(notification.tag, { environmentId, threadId, notification });
    setNotificationBadge(pending.size);
  };
  // Toast ids by thread key, so hiding or opening a thread, or removing its environment, closes them.
  const openToasts = new Map<string, Array<ToastId>>();
  const forgetToast = (key: string, toastId: ToastId) => {
    const remaining = (openToasts.get(key) ?? []).filter((id) => id !== toastId);
    if (remaining.length === 0) openToasts.delete(key);
    else openToasts.set(key, remaining);
  };
  const closeToasts = (shouldClose: (key: string) => boolean) => {
    for (const [key, toastIds] of openToasts) {
      if (!shouldClose(key)) continue;
      for (const toastId of toastIds) toastManager.close(toastId);
      openToasts.delete(key);
    }
  };
  // Failed-automation toasts outlive routine notifications being turned off.
  const automationFailureToasts = new Set<ToastId>();
  const closeRoutineToasts = () => {
    for (const [key, toastIds] of openToasts) {
      const kept = toastIds.filter((toastId) => automationFailureToasts.has(toastId));
      for (const toastId of toastIds) {
        if (!automationFailureToasts.has(toastId)) toastManager.close(toastId);
      }
      if (kept.length === 0) openToasts.delete(key);
      else openToasts.set(key, kept);
    }
  };
  const activeThread = () =>
    (router.state.matches.at(-1)?.params ?? {}) as {
      environmentId?: EnvironmentId;
      threadId?: ThreadId;
    };
  const closeOpenedThreadToasts = () => {
    const { environmentId, threadId } = activeThread();
    if (environmentId === undefined || threadId === undefined) return;
    const opened = threadKey({ environmentId, threadId });
    closeToasts((key) => key === opened);
  };
  // A notification shown before the tag filter turned on must not stay on screen. While hiding,
  // one whose thread left the live list (archived) cannot be judged, so it closes too.
  const closeHiddenPending = () => {
    const hidden = registry.get(environmentThreadShells.hiddenThreadKeysAtom);
    const live = registry.get(environmentThreadShells.anyEnvironmentHidingAtom)
      ? new Set(registry.get(environmentThreadShells.threadRefsAtom).map(threadKey))
      : null;
    const shouldClose = (key: string) => hidden.has(key) || (live !== null && !live.has(key));
    closeToasts(shouldClose);
    const count = pending.size;
    for (const [tag, entry] of pending) {
      if (!shouldClose(threadKey(entry))) continue;
      entry.notification.close();
      pending.delete(tag);
    }
    if (count !== pending.size) setNotificationBadge(pending.size);
  };
  const clearPending = () => {
    for (const { notification } of pending.values()) notification.close();
    pending.clear();
    setNotificationBadge(0);
  };

  const present = (
    environmentId: EnvironmentId,
    state: NotificationState,
    kind: ThreadNotificationKind,
  ) => {
    const { thread, status } = state;
    if (
      registry
        .get(environmentThreadShells.hiddenThreadKeysAtom)
        .has(threadKey({ environmentId, threadId: thread.id }))
    )
      return;
    const { notificationMode: mode, inAppNotificationsEnabled } = getClientSettings();
    const active = activeThread();
    const title =
      kind === "completion"
        ? "Thread completed"
        : status === "approval"
          ? "Approval needed"
          : status === "limited"
            ? "Usage limit reached"
            : status === "failed"
              ? "Thread failed"
              : status === "request"
                ? "Guest request"
                : "Input needed";
    if (hasNotificationSound(mode)) {
      void playNotificationSound(kind, () =>
        hasNotificationSound(getClientSettings().notificationMode),
      );
    }
    if (
      inAppNotificationsEnabled &&
      document.visibilityState === "visible" &&
      document.hasFocus() &&
      (active.environmentId !== environmentId || active.threadId !== thread.id)
    ) {
      const toastKey = threadKey({ environmentId, threadId: thread.id });
      const toastId: ToastId = toastManager.add({
        onRemove: (): void => forgetToast(toastKey, toastId),
        type: kind === "completion" ? "success" : status === "failed" ? "error" : "warning",
        title,
        description: thread.title,
        data: { hideCopyButton: true, leadingIcon: notificationIcon(kind, status) },
        actionProps: {
          children: "Open thread",
          onClick: () => {
            toastManager.close(toastId);
            void router.navigate({
              to: "/$environmentId/$threadId",
              params: { environmentId, threadId: thread.id },
            });
          },
        },
      });
      openToasts.set(toastKey, [...(openToasts.get(toastKey) ?? []), toastId]);
      return;
    }
    if (
      !hasDesktopNotifications(mode) ||
      (document.visibilityState === "visible" && document.hasFocus()) ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    )
      return;
    try {
      const notification = new Notification(title, {
        body: thread.title,
        tag: threadNotificationTag(environmentId, thread.id),
        silent: true,
        // Windows drops clicks after a toast moves into Notification Center.
        requireInteraction: kind === "completion" && isWindowsPlatform(navigator.platform),
      });
      trackNotification(environmentId, thread.id, notification);
      notification.addEventListener("click", () => {
        notification.close();
        window.focus();
        void window.desktopBridge?.revealWindow().catch(() => undefined);
        void router.navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId: thread.id },
        });
      });
    } catch {
      // Some browsers expose Notification but reject desktop presentation.
    }
  };

  // Failed automations notify even with routine notifications off. One that cannot show yet
  // stays pending until the app is in the foreground.
  const presentAutomationFailure = (
    environmentId: EnvironmentId,
    entry: WatchedEnvironment,
    state: NotificationState,
    failure: AutomationFailureNotice,
    playSound: boolean,
  ) => {
    const { thread, status } = state;
    const toastKey = threadKey({ environmentId, threadId: thread.id });
    if (registry.get(environmentThreadShells.hiddenThreadKeysAtom).has(toastKey)) return;
    const { notificationMode: mode } = getClientSettings();
    const title = "Automation failed";
    if (playSound && hasNotificationSound(mode)) {
      void playNotificationSound("input", () =>
        hasNotificationSound(getClientSettings().notificationMode),
      );
    }
    if (document.visibilityState === "visible" && document.hasFocus()) {
      const toastId: ToastId = toastManager.add({
        onRemove: (): void => {
          forgetToast(toastKey, toastId);
          automationFailureToasts.delete(toastId);
          entry.automationFailures.forget(thread.id, toastId);
        },
        type: status === "failed" ? "error" : "warning",
        timeout: 0,
        title,
        description: `${thread.title}. Open the chat for the cause and recovery steps.`,
        data: { hideCopyButton: true, leadingIcon: notificationIcon("input", status) },
        actionProps: {
          children: "Open thread",
          onClick: () => {
            toastManager.close(toastId);
            void router.navigate({
              to: "/$environmentId/$threadId",
              params: { environmentId, threadId: thread.id },
            });
          },
        },
      });
      openToasts.set(toastKey, [...(openToasts.get(toastKey) ?? []), toastId]);
      automationFailureToasts.add(toastId);
      entry.automationFailures.shown(thread.id, failure, toastId);
      return;
    }
    if (
      !hasDesktopNotifications(mode) ||
      typeof Notification === "undefined" ||
      Notification.permission !== "granted"
    )
      return;
    try {
      const notification = new Notification(title, {
        body: thread.title,
        tag: threadNotificationTag(environmentId, thread.id),
        silent: true,
      });
      trackNotification(environmentId, thread.id, notification);
      entry.automationFailures.shown(thread.id, failure);
      notification.addEventListener("click", () => {
        notification.close();
        window.focus();
        void window.desktopBridge?.revealWindow().catch(() => undefined);
        void router.navigate({
          to: "/$environmentId/$threadId",
          params: { environmentId, threadId: thread.id },
        });
      });
    } catch {
      // Some browsers expose Notification but reject desktop presentation.
    }
  };

  const observeThreads = (
    environmentId: EnvironmentId,
    entry: WatchedEnvironment,
    threads: ReadonlyArray<OrchestrationV2ThreadShell>,
  ) => {
    const previous = entry.previous;
    const next = new Map<ThreadId, NotificationState>();
    // A parent here also hears of what its tasks on linked environments ask.
    const subagentRequests = registry.get(
      environmentThreadShells.pendingSubagentRequestsAtom(environmentId),
    );
    const delegatedUnderParent = registry.get(environmentThreadShells.delegatedUnderParentAtom);
    const changed: Array<[NotificationState | undefined, NotificationState]> = [];
    const active = (router.state.matches.at(-1)?.params ?? {}) as {
      environmentId?: string;
      threadId?: string;
    };
    const foreground = document.visibilityState === "visible" && document.hasFocus();
    const now = Date.now();
    for (const rawThread of threads) {
      if (
        isShownUnderParent(
          { environmentId, threadId: rawThread.id },
          rawThread.lineage,
          delegatedUnderParent,
        )
      ) {
        continue;
      }
      const prior = previous.get(rawThread.id);
      const subagentRequest = subagentRequests.get(rawThread.id) ?? null;
      const automationFailure = entry.automationFailures.observe(
        rawThread.id,
        rawThread.lastAutomationFailure,
        unreadAutomationFailure(rawThread, now),
        foreground && active.environmentId === environmentId && active.threadId === rawThread.id,
      );
      if (
        !entry.reconnecting &&
        prior?.raw === rawThread &&
        prior.subagentRequest === subagentRequest &&
        !automationFailure
      ) {
        next.set(rawThread.id, prior);
        continue;
      }
      const thread = presentThreadShell(environmentId, rawThread, subagentRequest);
      let status = resolveSidebarThreadStatus(thread);
      if (status === "ready" && thread.latestRun?.status === "failed") status = "failed";
      const needsAttention =
        status === "input" ||
        status === "request" ||
        status === "approval" ||
        status === "failed" ||
        status === "limited";
      const requestId = needsAttention ? resolveBackgroundThreadRequest(thread).requestId : null;
      // Queued messages become the latest run while a request stays pending, so a request
      // with an id is keyed by that id alone and announces once.
      const attention = !needsAttention
        ? null
        : requestId !== null
          ? `${status}:${requestId}`
          : `${thread.latestRun?.runId ?? ""}:${status}`;
      const completed = status === "ready" && thread.latestRun?.status === "completed";
      const settled = completed && !monitorHoldsWakeCompletion(rawThread);
      const parsedCompletedAt = Date.parse(thread.latestRun?.completedAt ?? "");
      const completedAt = Number.isFinite(parsedCompletedAt) ? parsedCompletedAt : null;
      const state = {
        raw: rawThread,
        subagentRequest,
        thread,
        status,
        attention,
        requestId,
        settled,
        completedAt: settled ? completedAt : null,
        backgroundWake: rawThread.latestRunBackgroundWake === true,
        automationFailure,
      };
      next.set(thread.id, state);
      changed.push([prior, state]);
    }
    entry.reconnecting = false;
    entry.previous = next;
    entry.gate.retain(new Set(next.keys()));
    entry.automationFailures.retain(new Set(next.keys()));
    for (const [prior, state] of changed) {
      entry.gate.observe(state.thread.id, prior, state, {
        archived: state.thread.archivedAt !== null,
        quiet: state.raw.latestRunStopRequested === true,
        snoozed: isSnoozedForNotification(state.thread, state.completedAt, now),
      });
      if (state.automationFailure) {
        presentAutomationFailure(
          environmentId,
          entry,
          state,
          state.automationFailure,
          // Only a newly arrived failure sounds; one shown later on focus stays quiet.
          prior?.raw.lastAutomationFailure?.messageId !== state.automationFailure.messageId,
        );
      }
    }
  };

  const watchEnvironment = (environmentId: EnvironmentId): WatchedEnvironment => {
    const entry: WatchedEnvironment = {
      previous: new Map(),
      reconnecting: false,
      unsubscribe: () => {},
      reobserve: () => {},
      gate: createThreadNotificationGate<ThreadId>((threadId, kind) => {
        const state = entry.previous.get(threadId);
        // An automation failure replaces the routine notice for the same transition.
        if (state && !state.automationFailure) present(environmentId, state, kind);
      }),
      automationFailures: createAutomationFailureNotices<ThreadId, ToastId>((toastId) =>
        toastManager.close(toastId),
      ),
    };
    let threads: ReadonlyArray<OrchestrationV2ThreadShell> | null = null;
    const unsubscribeShell = registry.subscribe(
      environmentShell.stateValueAtom(environmentId),
      (shell) => {
        threads =
          shell.status === "live" && Option.isSome(shell.snapshot)
            ? shell.snapshot.value.threads
            : null;
        if (threads !== null) {
          observeThreads(environmentId, entry, threads);
          return;
        }
        entry.reconnecting = true;
        entry.gate.pause();
      },
      { immediate: true },
    );
    const reobserve = () => {
      if (threads !== null) observeThreads(environmentId, entry, threads);
    };
    const unsubscribeRequests = registry.subscribe(
      environmentThreadShells.pendingSubagentRequestsAtom(environmentId),
      reobserve,
    );
    const unsubscribeDelegated = registry.subscribe(
      environmentThreadShells.delegatedUnderParentAtom,
      reobserve,
    );
    entry.reobserve = reobserve;
    entry.unsubscribe = () => {
      unsubscribeShell();
      unsubscribeRequests();
      unsubscribeDelegated();
      entry.gate.clear();
      entry.automationFailures.clear();
    };
    return entry;
  };

  // Always watched: failed automations notify even with routine notifications off.
  const syncEnvironments = () => {
    const environmentIds = registry.get(environmentSummaries.environmentIdsAtom);
    const activeIds = new Set(environmentIds);
    for (const [environmentId, entry] of watched) {
      if (activeIds.has(environmentId)) continue;
      entry.unsubscribe();
      watched.delete(environmentId);
    }
    for (const environmentId of environmentIds) {
      if (!watched.has(environmentId)) watched.set(environmentId, watchEnvironment(environmentId));
    }
  };

  const pruneRemovedEnvironments = () => {
    const activeIds = new Set(registry.get(environmentSummaries.environmentIdsAtom));
    closeToasts((key) => !activeIds.has(parseThreadKey(key).environmentId));
    const count = pending.size;
    for (const [tag, entry] of pending) {
      if (activeIds.has(entry.environmentId)) continue;
      entry.notification.close();
      pending.delete(tag);
    }
    if (count !== pending.size) setNotificationBadge(pending.size);
  };

  // Listeners that only exist for some notification modes, rebuilt when the mode changes.
  let appliedMode: ClientSettings["notificationMode"] | null = null;
  let stopModeListeners = () => {};
  const applyMode = () => {
    const nextMode = getClientSettings().notificationMode;
    if (nextMode === appliedMode) return;
    appliedMode = nextMode;
    stopModeListeners();
    clearPending();
    const stops: Array<() => void> = [];
    if (hasDesktopNotifications(nextMode)) {
      const unsubscribeBadgeClear = window.desktopBridge?.onNotificationBadgeClear(clearPending);
      window.addEventListener("focus", clearPending);
      stops.push(() => {
        unsubscribeBadgeClear?.();
        window.removeEventListener("focus", clearPending);
        clearPending();
      });
    }
    if (hasNotificationSound(nextMode)) {
      document.addEventListener("pointerdown", unlockNotificationAudio);
      document.addEventListener("keydown", unlockNotificationAudio);
      stops.push(() => {
        document.removeEventListener("pointerdown", unlockNotificationAudio);
        document.removeEventListener("keydown", unlockNotificationAudio);
      });
    }
    stopModeListeners = () => {
      for (const stop of stops) stop();
    };
  };

  const onSettings = () => {
    const { notificationMode, inAppNotificationsEnabled } = getClientSettings();
    if (notificationMode === "off" && !inAppNotificationsEnabled) closeRoutineToasts();
    applyMode();
    syncEnvironments();
  };
  const unsubscribeSettings = subscribeClientSettings(onSettings);
  const unsubscribeEnvironmentIds = registry.subscribe(
    environmentSummaries.environmentIdsAtom,
    () => {
      pruneRemovedEnvironments();
      syncEnvironments();
    },
  );
  const unsubscribeHidden = [
    registry.subscribe(environmentThreadShells.hiddenThreadKeysAtom, closeHiddenPending),
    registry.subscribe(environmentThreadShells.anyEnvironmentHidingAtom, closeHiddenPending),
    registry.subscribe(environmentThreadShells.threadRefsAtom, closeHiddenPending),
  ];
  // Returning to the app shows failed automations that could not show while it was away.
  const reobserveAll = () => {
    for (const entry of watched.values()) entry.reobserve();
  };
  window.addEventListener("focus", reobserveAll);
  document.addEventListener("visibilitychange", reobserveAll);
  const unsubscribeRoute = router.subscribe("onResolved", closeOpenedThreadToasts);
  onSettings();

  return () => {
    window.removeEventListener("focus", reobserveAll);
    document.removeEventListener("visibilitychange", reobserveAll);
    unsubscribeSettings();
    unsubscribeEnvironmentIds();
    for (const unsubscribe of unsubscribeHidden) unsubscribe();
    unsubscribeRoute();
    for (const entry of watched.values()) entry.unsubscribe();
    watched.clear();
    stopModeListeners();
    closeToasts(() => true);
  };
}
