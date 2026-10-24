import type { InboxSource } from "@t3tools/contracts";
import { useId } from "react";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** The wrapper keeps the disabled button's explanation available on hover and focus. */
export function DisabledIntegrationConnectButton({
  source,
  reason,
}: {
  source: InboxSource;
  reason: string;
}) {
  const name = source.charAt(0).toUpperCase() + source.slice(1);
  const tooltipId = useId();
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            className="inline-flex cursor-not-allowed"
            tabIndex={0}
            aria-describedby={tooltipId}
          >
            <Button size="sm" variant="outline" disabled>
              Connect {name}
            </Button>
          </span>
        }
      />
      <TooltipPopup id={tooltipId} role="tooltip">
        {reason}
      </TooltipPopup>
    </Tooltip>
  );
}
