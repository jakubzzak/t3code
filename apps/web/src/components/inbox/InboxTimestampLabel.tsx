import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import type { ReactNode } from "react";
import { formatInboxTimestamp, formatInboxTimestampTooltip } from "./inboxTimestampFormat";

export function InboxTimestampLabel({
  timestamp,
  children,
  label,
}: {
  timestamp: string;
  children?: ReactNode;
  label?: string;
}) {
  const dateTime = formatInboxTimestampTooltip(timestamp);
  const fullTimestamp = label ? `${label} ${dateTime}` : dateTime;
  return (
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
        {children ?? formatInboxTimestamp(timestamp)}
      </TooltipTrigger>
      <TooltipPopup>{fullTimestamp}</TooltipPopup>
    </Tooltip>
  );
}
