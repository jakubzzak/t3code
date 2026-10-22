import type { InboxNotification, InboxSourceItem } from "@t3tools/contracts";
import { emailText } from "@t3tools/shared/emailText";

/** Mark converted content so literal HTML examples in plain text are never parsed again. */
export function readableInboxItem(item: InboxSourceItem): InboxSourceItem {
  if (item.source !== "superhuman" || item.contentFormat === "text") return item;
  return { ...item, content: emailText(item.content), contentFormat: "text" };
}

/** Repair cached email presentation without changing read, triage or chat state. */
export function readableNotification(notification: InboxNotification): InboxNotification {
  const items = notification.items.map(readableInboxItem);
  if (items.every((item, index) => item === notification.items[index])) return notification;
  const changed = items.some((item, index) => item.content !== notification.items[index]?.content);
  return {
    ...notification,
    items,
    ...(changed
      ? { analysis: null, processingError: null, analysisVersion: notification.analysisVersion + 1 }
      : {}),
  };
}
