import type { InboxNotification, ServerSettings } from "@t3tools/contracts";

/** Visibility never changes retained notification state or background processing. */
export function isInboxNotificationVisible(
  notification: InboxNotification,
  settings: Pick<ServerSettings, "inboxShowSelfUpdates" | "inboxShowSelfReplies"> | undefined,
) {
  const activity = notification.replyCursor;
  if (!activity?.isSelf) return true;
  return activity.kind === "update"
    ? settings?.inboxShowSelfUpdates !== false
    : settings?.inboxShowSelfReplies !== false;
}
