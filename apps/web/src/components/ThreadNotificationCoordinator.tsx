import {
  type PendingSubagentRequest,
  presentThreadShell,
} from "@t3tools/client-runtime/state/models";
import { pendingSubagentRequestsByThread } from "@t3tools/client-runtime/state/threads";
import { useAtomValue } from "@effect/atom-react";
import { useNavigate, useParams } from "@tanstack/react-router";
import type { EnvironmentId, OrchestrationV2ThreadShell, ThreadId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as DateTime from "effect/DateTime";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  MessageCircleQuestionIcon,
  ShieldQuestionIcon,
} from "lucide-react";
import { useCallback, useEffect, useReducer, useRef } from "react";

import { getClientSettings, useClientSettings } from "../hooks/useSettings";
import { useEnvironmentIds } from "../state/environments";
import { environmentShell } from "../state/shell";
import {
  hasDesktopNotifications,
  hasNotificationSound,
  playNotificationSound,
  setNotificationBadge,
  unlockNotificationAudio,
} from "../threadNotifications";
import { resolveSidebarThreadStatus } from "./Sidebar.logic";
import { toastManager } from "./ui/toast";

export function ThreadNotificationCoordinator() {
  const environmentIds = useEnvironmentIds();
  const mode = useClientSettings((settings) => settings.notificationMode);
  const pending = useRef(
    new Map<string, { environmentId: EnvironmentId; notification: Notification }>(),
  );
  const onNotification = useCallback((environmentId: EnvironmentId, notification: Notification) => {
    pending.current.get(notification.tag)?.notification.close();
    pending.current.set(notification.tag, { environmentId, notification });
    setNotificationBadge(pending.current.size);
  }, []);

  useEffect(() => {
    const activeIds = new Set(environmentIds);
    const count = pending.current.size;
    for (const [tag, { environmentId, notification }] of pending.current) {
      if (activeIds.has(environmentId)) continue;
      notification.close();
      pending.current.delete(tag);
    }
    if (count !== pending.current.size) setNotificationBadge(pending.current.size);
  }, [environmentIds]);

  useEffect(() => {
    const clear = () => {
      for (const { notification } of pending.current.values()) notification.close();
      pending.current.clear();
      setNotificationBadge(0);
    };
    clear();
    if (!hasDesktopNotifications(mode)) return;
    const unsubscribe = window.desktopBridge?.onNotificationBadgeClear?.(clear);
    window.addEventListener("focus", clear);
    return () => {
      unsubscribe?.();
      window.removeEventListener("focus", clear);
      clear();
    };
  }, [mode]);

  useEffect(() => {
    if (!hasNotificationSound(mode)) return;
    document.addEventListener("pointerdown", unlockNotificationAudio);
    document.addEventListener("keydown", unlockNotificationAudio);
    return () => {
      document.removeEventListener("pointerdown", unlockNotificationAudio);
      document.removeEventListener("keydown", unlockNotificationAudio);
    };
  }, [mode]);

  return environmentIds.map((environmentId) => (
    <EnvironmentNotifications
      key={environmentId}
      environmentId={environmentId}
      onNotification={onNotification}
    />
  ));
}

interface NotificationState {
  readonly raw: OrchestrationV2ThreadShell;
  readonly subagentRequest: PendingSubagentRequest | null;
  readonly attention: string | null;
  readonly completion: number | null;
}

function EnvironmentNotifications({
  environmentId,
  onNotification,
}: {
  environmentId: EnvironmentId;
  onNotification: (environmentId: EnvironmentId, notification: Notification) => void;
}) {
  const shell = useAtomValue(environmentShell.stateValueAtom(environmentId));
  // The shell reducer keeps the thread list and unchanged thread objects
  // stable, so this only rescans when a thread actually changed.
  const threads =
    shell.status === "live" && Option.isSome(shell.snapshot) ? shell.snapshot.value.threads : null;
  const mode = useClientSettings((settings) => settings.notificationMode);
  const inAppNotificationsEnabled = useClientSettings(
    (settings) => settings.inAppNotificationsEnabled,
  );
  const navigate = useNavigate();
  const { environmentId: activeEnvironmentId, threadId: activeThreadId } = useParams({
    strict: false,
  });
  const previous = useRef(new Map<ThreadId, NotificationState>());
  const notifiedAutomationFailures = useRef(new Map<ThreadId, string>());
  const automationToasts = useRef(new Map<ThreadId, string>());
  const [foregroundVersion, refreshForeground] = useReducer((version: number) => version + 1, 0);

  useEffect(() => {
    const toasts = automationToasts.current;
    window.addEventListener("focus", refreshForeground);
    document.addEventListener("visibilitychange", refreshForeground);
    return () => {
      window.removeEventListener("focus", refreshForeground);
      document.removeEventListener("visibilitychange", refreshForeground);
      for (const id of toasts.values()) toastManager.close(id);
    };
  }, []);

  useEffect(() => {
    if (threads === null) {
      previous.current.clear();
      return;
    }
    const next = new Map<ThreadId, NotificationState>();
    // Subagents are skipped below, so their requests notify through the thread above them.
    const subagentRequests = pendingSubagentRequestsByThread(threads);
    for (const rawThread of threads) {
      if (rawThread.lineage.relationshipToParent === "subagent") continue;
      const prior = previous.current.get(rawThread.id);
      const subagentRequest = subagentRequests.get(rawThread.id) ?? null;
      const failure = rawThread.lastAutomationFailure;
      const failureKey = failure ? `${rawThread.id}:${failure.messageId}` : null;
      const viewingThread =
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        activeEnvironmentId === environmentId &&
        activeThreadId === rawThread.id;
      if (failureKey && viewingThread)
        notifiedAutomationFailures.current.set(rawThread.id, failureKey);
      const unreadFailure =
        failure &&
        rawThread.status === "failed" &&
        rawThread.archivedAt === null &&
        rawThread.settledOverride !== "settled" &&
        (rawThread.snoozedUntil == null ||
          DateTime.toEpochMillis(rawThread.snoozedUntil) <= Date.now()) &&
        (rawThread.lastVisitedAt == null ||
          Date.parse(failure.occurredAt) > DateTime.toEpochMillis(rawThread.lastVisitedAt));
      const previousToast = automationToasts.current.get(rawThread.id);
      if (previousToast && (!unreadFailure || viewingThread)) {
        toastManager.close(previousToast);
        automationToasts.current.delete(rawThread.id);
      }
      const automationFailure =
        failure &&
        failureKey &&
        unreadFailure &&
        notifiedAutomationFailures.current.get(rawThread.id) !== failureKey
          ? failure
          : null;
      // The same object cannot produce a new notification.
      if (
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
      const attention =
        status === "input" || status === "approval" || status === "failed" || status === "limited"
          ? `${thread.latestRun?.runId ?? ""}:${status}`
          : null;
      const completedAt = Date.parse(thread.latestRun?.completedAt ?? "");
      // Commands left running (a dev server) read as ready; subagents and monitors wait.
      const completion =
        status === "ready" &&
        thread.latestRun?.status === "completed" &&
        Number.isFinite(completedAt)
          ? completedAt
          : (prior?.completion ?? null);
      next.set(thread.id, { raw: rawThread, subagentRequest, attention, completion });
      // Unread automation failures survive disconnects and can first arrive already failed.
      if ((!prior && !automationFailure) || thread.archivedAt !== null) continue;
      const kind =
        automationFailure || (attention && attention !== prior?.attention)
          ? "input"
          : completion !== null && (prior?.completion == null || completion > prior.completion)
            ? "completion"
            : null;
      if (!kind) continue;
      const title = automationFailure
        ? "Automation failed"
        : kind === "completion"
          ? "Thread completed"
          : status === "approval"
            ? "Approval needed"
            : status === "limited"
              ? "Usage limit reached"
              : status === "failed"
                ? "Thread failed"
                : "Input needed";
      if (
        hasNotificationSound(mode) &&
        (!automationFailure ||
          prior?.raw.lastAutomationFailure?.messageId !== automationFailure.messageId)
      ) {
        void playNotificationSound(kind, () =>
          hasNotificationSound(getClientSettings().notificationMode),
        );
      }
      if (
        (inAppNotificationsEnabled || automationFailure) &&
        document.visibilityState === "visible" &&
        document.hasFocus() &&
        (activeEnvironmentId !== environmentId || activeThreadId !== thread.id)
      ) {
        const toastId = toastManager.add({
          type: kind === "completion" ? "success" : status === "failed" ? "error" : "warning",
          ...(automationFailure ? { timeout: 0 } : {}),
          title,
          description: automationFailure
            ? `${thread.title}: ${automationFailure.message}`
            : thread.title,
          data: {
            hideCopyButton: true,
            leadingIcon:
              kind === "completion" ? (
                <CircleCheckIcon aria-hidden className="size-4 text-success-foreground" />
              ) : status === "approval" ? (
                <ShieldQuestionIcon aria-hidden className="size-4 text-warning-foreground" />
              ) : status === "failed" ? (
                <CircleAlertIcon aria-hidden className="size-4 text-destructive-foreground" />
              ) : (
                <MessageCircleQuestionIcon aria-hidden className="size-4 text-info-foreground" />
              ),
          },
          actionProps: {
            children: "Open thread",
            onClick: () => {
              toastManager.close(toastId);
              void navigate({
                to: "/$environmentId/$threadId",
                params: { environmentId, threadId: thread.id },
              });
            },
          },
        });
        if (automationFailure && failureKey) {
          const previousToast = automationToasts.current.get(rawThread.id);
          if (previousToast) toastManager.close(previousToast);
          automationToasts.current.set(rawThread.id, toastId);
          notifiedAutomationFailures.current.set(rawThread.id, failureKey);
        }
        continue;
      }
      if (
        !hasDesktopNotifications(mode) ||
        (document.visibilityState === "visible" && document.hasFocus()) ||
        typeof Notification === "undefined" ||
        Notification.permission !== "granted"
      )
        continue;
      try {
        const notification = new Notification(title, {
          body: thread.title,
          tag: `${environmentId}:${thread.id}`,
          silent: true,
        });
        onNotification(environmentId, notification);
        if (automationFailure && failureKey)
          notifiedAutomationFailures.current.set(rawThread.id, failureKey);
        notification.addEventListener("click", () => {
          notification.close();
          window.focus();
          void navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId, threadId: thread.id },
          });
        });
      } catch {
        // Some browsers expose Notification but reject desktop presentation.
      }
    }
    for (const [threadId, toastId] of automationToasts.current) {
      if (next.has(threadId)) continue;
      toastManager.close(toastId);
      automationToasts.current.delete(threadId);
    }
    previous.current = next;
  }, [
    activeEnvironmentId,
    activeThreadId,
    environmentId,
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Focus must recheck unread failures even when the shell has not changed.
    foregroundVersion,
    inAppNotificationsEnabled,
    mode,
    navigate,
    onNotification,
    threads,
  ]);

  return null;
}
