import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatInboxTimestamp, formatInboxTimestampTooltip } from "./inboxTimestampFormat";

export function InboxTimestampLabel({ timestamp }: { timestamp: string }) {
  const fullTimestamp = formatInboxTimestampTooltip(timestamp);
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
        {formatInboxTimestamp(timestamp)}
      </TooltipTrigger>
      <TooltipPopup>{fullTimestamp}</TooltipPopup>
    </Tooltip>
  );
}
