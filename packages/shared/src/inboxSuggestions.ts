import type { InboxNotification, ServerSettings } from "@t3tools/contracts";

/** The same suggested task is shown in Inbox and handed to either agent action. */
export function inboxSuggestedPrompt(
  notification: Pick<InboxNotification, "analysis">,
  settings: Pick<ServerSettings, "inboxSummaryEnabled" | "inboxPreResolution">,
): string {
  if (!settings.inboxSummaryEnabled || !settings.inboxPreResolution) return "";
  return (
    notification.analysis?.suggestions
      .map((text) => text.trim())
      .filter(Boolean)
      .join("\n\n") ?? ""
  );
}
