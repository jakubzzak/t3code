import type { InboxSource } from "@t3tools/contracts";

/** Connections belong to one explicit project, never an environment-wide selection. */
export function integrationDisabledReason(
  source: InboxSource,
  projectSelected: boolean,
  projectCount: number,
  settings: { inboxEnabled: boolean; linearViewEnabled: boolean },
) {
  if (!projectSelected)
    return `Select a project above, then enable ${source === "linear" ? "Linear view or Inbox" : "Inbox"} in Features.`;
  if (projectCount !== 1)
    return "Select one project checkout or environment above to configure its connection.";
  if (
    source === "linear"
      ? !settings.linearViewEnabled && !settings.inboxEnabled
      : !settings.inboxEnabled
  )
    return `Enable ${source === "linear" ? "Linear view or Inbox" : "Inbox"} for this project in Features.`;
  return null;
}
