import { useEffect, useEffectEvent, useState, type RefObject } from "react";
import type { EnvironmentId, ProjectId, InboxLinearAgentIdentity } from "@t3tools/contracts";
import { inboxEnvironment } from "~/state/inbox";
import { useEnvironmentQuery } from "~/state/query";

/** Activity is observed independently of cached history, only while its reader is visible. */
export function useInboxLinearAgentThread({
  environmentId,
  projectId,
  notificationId,
  commentId,
  initialIdentity,
  element,
}: {
  environmentId: EnvironmentId | undefined;
  projectId: ProjectId;
  notificationId: string;
  commentId: string | null;
  initialIdentity?: InboxLinearAgentIdentity | undefined;
  element: RefObject<HTMLElement | null>;
}) {
  const [visibility, setVisibility] = useState({ visible: false, since: 0 });
  useEffect(() => {
    let intersecting = typeof IntersectionObserver === "undefined";
    const sync = () => {
      const visible = intersecting && document.visibilityState !== "hidden";
      setVisibility((previous) =>
        previous.visible === visible ? previous : { visible, since: Date.now() },
      );
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(([entry]) => {
            intersecting = entry?.isIntersecting ?? false;
            sync();
          });
    if (element.current) observer?.observe(element.current);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [element]);
  const enabled = visibility.visible && !!environmentId && !!commentId;
  const query = useEnvironmentQuery(
    enabled && environmentId
      ? inboxEnvironment.linearAgentThread({
          environmentId,
          input: { projectId, id: notificationId },
        })
      : null,
  );
  const refresh = useEffectEvent((onArrival: boolean) => {
    if (!query.isPending && (!onArrival || query.dataUpdatedAt < visibility.since)) query.refresh();
  });
  useEffect(() => {
    if (!enabled) return;
    // A cached atom can survive closing/reopening a conversation; do not pulse it on arrival.
    refresh(true);
    const timer = window.setInterval(() => {
      refresh(false);
    }, 10_000);
    return () => window.clearInterval(timer);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- A destination or source-thread change must replace the status timer.
  }, [enabled, visibility.since, environmentId, projectId, notificationId, commentId]);
  const [expiredResponse, setExpiredResponse] = useState(0);
  useEffect(() => {
    if (!enabled || !query.dataUpdatedAt) return;
    const timestamp = query.dataUpdatedAt;
    const timer = window.setTimeout(
      () => setExpiredResponse(timestamp),
      Math.max(0, timestamp + 25_000 - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [enabled, query.dataUpdatedAt]);
  // Preview identity is durable; only a fresh activity observation may indicate work.
  const observed = query.data?.commentId === commentId ? query.data : null;
  const thread = observed ?? (!query.isSuccess && commentId ? (initialIdentity ?? null) : null);
  return {
    thread,
    working:
      enabled &&
      query.isSuccess &&
      observed?.status === "active" &&
      query.dataUpdatedAt >= visibility.since &&
      query.dataUpdatedAt > expiredResponse,
  };
}
