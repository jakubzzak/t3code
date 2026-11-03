import type { InboxListFilters, InboxNotification, ServerSettings } from "@t3tools/contracts";

/** Visibility uses persisted decisions; changing a threshold never reclassifies old content. */
export function isInboxNotificationVisible(
  notification: InboxNotification,
  settings:
    | (Pick<ServerSettings, "inboxShowSelfUpdates" | "inboxShowSelfReplies"> &
        Partial<Pick<ServerSettings, "inboxFilterIrrelevant">>)
    | undefined,
  visibility: "inbox" | "visible" | "filtered" | "all" = "visible",
) {
  if (visibility === "all") return true;
  const activity = notification.replyCursor;
  const hidden =
    notification.state.irrelevant === true ||
    (notification.state.irrelevant !== false &&
      (visibility === "inbox" || settings?.inboxFilterIrrelevant !== false) &&
      notification.relevance?.status === "complete" &&
      notification.relevance.irrelevant) ||
    (visibility !== "inbox" &&
      activity?.isSelf &&
      (activity.kind === "update"
        ? settings?.inboxShowSelfUpdates === false
        : settings?.inboxShowSelfReplies === false));
  return visibility === "filtered" ? !!hidden : !hidden;
}

/** Explicit list facets are independent of automatic visibility preferences. */
export function matchesInboxListFilters(
  notification: InboxNotification,
  filters: InboxListFilters | undefined,
): boolean {
  if (
    filters?.sources &&
    (filters.include || filters.sources.length > 0) &&
    !filters.sources.includes(notification.source)
  )
    return false;
  const irrelevant =
    notification.state.irrelevant === true ||
    (notification.state.irrelevant !== false &&
      notification.relevance?.status === "complete" &&
      notification.relevance.irrelevant);
  if (filters?.include) {
    const include = filters.include;
    if (!include.unread && !notification.state.read) return false;
    if (!include.irrelevant && irrelevant) return false;
    const activity = notification.replyCursor;
    if (
      activity?.isSelf &&
      !(activity.kind === "update" ? include.selfUpdates : include.selfReplies)
    )
      return false;
    return true;
  }
  if (filters?.unreadOnly && notification.state.read) return false;
  if (filters?.irrelevantOnly && !irrelevant) return false;
  if (filters?.selfActivity?.length) {
    const activity = notification.replyCursor;
    if (!activity?.isSelf || !filters.selfActivity.includes(activity.kind ?? "reply")) return false;
  }
  return true;
}
