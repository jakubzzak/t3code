import { useCallback } from "react";
import { useOpenLink } from "~/browser/useOpenLink";
import type { InboxNotification, ScopedThreadRef } from "@t3tools/contracts";
import { slackLinkUrl } from "@t3tools/shared/slackText";
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

/** Apply the normal browser preference, permission checks and modifier-click behavior. */
export function useInboxLink(threadRef?: ScopedThreadRef | null) {
  const openLink = useOpenLink(threadRef);
  return useCallback(
    (value: string, event?: { metaKey: boolean; ctrlKey: boolean; button?: number }) => {
      const url = slackLinkUrl(value);
      if (!url) return;
      void openLink(url, event ? { event } : undefined).catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not open link",
          description: error instanceof Error ? error.message : "Try opening the source again.",
        });
      });
    },
    [openLink],
  );
}
