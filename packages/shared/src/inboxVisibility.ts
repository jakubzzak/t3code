import type { InboxNotification, ServerSettings } from "@t3tools/contracts";

/** Visibility uses persisted decisions; changing a threshold never reclassifies old content. */
export function isInboxNotificationVisible(
  notification: InboxNotification,
  settings:
    | (Pick<ServerSettings, "inboxShowSelfUpdates" | "inboxShowSelfReplies"> &
        Partial<Pick<ServerSettings, "inboxFilterIrrelevant">>)
    | undefined,
  visibility: "visible" | "filtered" | "all" = "visible",
) {
  if (visibility === "all") return true;
  const activity = notification.replyCursor;
  const hidden =
    notification.state.irrelevant === true ||
    (notification.state.irrelevant !== false &&
      settings?.inboxFilterIrrelevant !== false &&
      notification.relevance?.status === "complete" &&
      notification.relevance.irrelevant) ||
    (activity?.isSelf &&
      (activity.kind === "update"
        ? settings?.inboxShowSelfUpdates === false
        : settings?.inboxShowSelfReplies === false));
  return visibility === "filtered" ? !!hidden : !hidden;
}
