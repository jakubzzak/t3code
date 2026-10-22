import type { InboxNotification } from "@t3tools/contracts";
import type { ReactNode } from "react";
import { useClientSettings } from "~/hooks/useSettings";
import { formatCompactTimestamp, formatChatTimestampTooltip } from "~/timestampFormat";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { InboxSourceLogo } from "./InboxSourceLogo";

export function InboxNotificationMetadata({
  notification,
  trailing,
}: {
  notification: InboxNotification;
  trailing?: ReactNode;
}) {
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const item = notification.items.at(-1);
  const timestamp = item?.occurredAt ?? notification.updatedAt;
  const fullTimestamp = formatChatTimestampTooltip(timestamp, timestampFormat);
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
      <Tooltip>
        <TooltipTrigger
          render={
            <time
              dateTime={timestamp}
              aria-label={fullTimestamp}
              className="shrink-0 whitespace-nowrap tabular-nums"
            />
          }
        >
          {formatCompactTimestamp(timestamp, timestampFormat)}
        </TooltipTrigger>
        <TooltipPopup>{fullTimestamp}</TooltipPopup>
      </Tooltip>
      {trailing}
    </div>
  );
}
