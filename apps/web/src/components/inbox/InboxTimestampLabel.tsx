import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { formatInboxTimestamp, formatInboxTimestampTooltip } from "./inboxTimestampFormat";

export function InboxTimestampLabel({
  timestamp,
  sameDayAs,
}: {
  timestamp: string;
  sameDayAs?: string | undefined;
}) {
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
        {formatInboxTimestamp(timestamp, sameDayAs)}
      </TooltipTrigger>
      <TooltipPopup>{fullTimestamp}</TooltipPopup>
    </Tooltip>
  );
}
