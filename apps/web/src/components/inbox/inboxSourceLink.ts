import type { InboxNotification } from "@t3tools/contracts";
import { slackLinkUrl } from "@t3tools/shared/slackText";
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
  openInboxLink(url);
}

/** Preserve the shell's normal link opening and error reporting for message links as well. */
export function openInboxLink(value: string) {
  const url = slackLinkUrl(value);
  if (!url) return;
  void readLocalApi()
    ?.shell.openExternal(url)
    .catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Could not open link",
        description: error instanceof Error ? error.message : "Try opening the source again.",
      });
    });
}
