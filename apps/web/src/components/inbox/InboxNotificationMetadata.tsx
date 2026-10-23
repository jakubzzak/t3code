import type { InboxNotification } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { InboxTimestampLabel } from "./InboxTimestampLabel";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { InboxSourceLogo } from "./InboxSourceLogo";

export function InboxNotificationMetadata({
  notification,
  trailing,
}: {
  notification: InboxNotification;
  trailing?: ReactNode;
}) {
  const item = notification.items.at(-1);
  const timestamp = item?.occurredAt ?? notification.updatedAt;
  return (
    <div className="flex items-center gap-1.5 text-2xs text-muted-foreground">
      <InboxSourceLogo source={notification.source} />
      <Tooltip>
        <TooltipTrigger render={<div className="flex min-w-0 flex-1 items-center gap-1" />}>
          {item?.author && (
            <span className="max-w-1/2 shrink-0 truncate font-medium">{item.author}</span>
          )}
          {item?.author && item.location && <span aria-hidden>·</span>}
          <span className="min-w-0 truncate">{item?.location}</span>
        </TooltipTrigger>
        <TooltipPopup>{[item?.author, item?.location].filter(Boolean).join(" · ")}</TooltipPopup>
      </Tooltip>
      <InboxTimestampLabel timestamp={timestamp} />
      {trailing}
    </div>
  );
}
