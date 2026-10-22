import type { InboxNotification } from "@t3tools/contracts";
/** Bound provider context independently of stored detail; keep the latest triggering activity. */
export function inboxContext(notification: InboxNotification) {
  return JSON.stringify({
    notificationId: notification.id,
    source: notification.source,
    omittedEarlierItems: Math.max(0, notification.items.length - 10),
    items: notification.items.slice(-10).map((item) => ({
      ...item,
      content: item.content.slice(0, 4000),
      truncated: item.content.length > 4000,
    })),
    analysis: notification.analysis,
  });
}
