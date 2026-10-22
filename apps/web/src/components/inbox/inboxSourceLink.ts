import type { InboxNotification } from "@t3tools/contracts";
import { readLocalApi } from "~/localApi";
import { toastManager } from "../ui/toast";

export function inboxSourceUrl(notification: InboxNotification) {
  const url = notification.items.at(-1)?.url;
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}

/** Use the same external-opening path for the source icon and focused-list shortcut. */
export function openInboxOriginal(notification: InboxNotification) {
  const url = inboxSourceUrl(notification);
  if (!url) return;
  void readLocalApi()
    ?.shell.openExternal(url)
    .catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not open original",
        description: error instanceof Error ? error.message : "Try opening the source again.",
      });
    });
}
