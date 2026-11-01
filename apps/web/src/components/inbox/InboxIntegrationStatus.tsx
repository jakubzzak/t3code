import type { InboxSourceConnection } from "@t3tools/contracts";
import { useEffect, useId, useState } from "react";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { inboxIntegrationStatus } from "./integrationStatusPresentation";

/** A local clock ages the cue without adding requests or rerendering the inbox list. */
export function InboxIntegrationStatus({
  connections,
}: {
  connections: ReadonlyArray<InboxSourceConnection>;
}) {
  const triggerId = useId();
  const [now, setNow] = useState(Date.now);
  const [open, setOpen] = useState(false);
  const hasErrors = connections.some((connection) => connection.enabled && connection.error);
  useEffect(() => {
    if (!hasErrors) return;
    const update = () => {
      if (document.visibilityState === "visible") setNow(Date.now());
    };
    update();
    const timer = window.setInterval(update, 30_000);
    document.addEventListener("visibilitychange", update);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", update);
    };
  }, [hasErrors]);
  const status = inboxIntegrationStatus(connections, now);
  if (!status) return null;
  return (
    <Tooltip triggerId={triggerId} open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        id={triggerId}
        closeOnClick={false}
        render={<Button variant="ghost" size="icon-tiny" />}
        aria-label="Integration updates delayed"
        aria-describedby={open ? `${triggerId}-tooltip` : undefined}
        onClick={() => setOpen(true)}
      >
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full ring-1 ring-black/40 dark:ring-white/15"
          style={{ backgroundColor: status.color }}
        />
      </TooltipTrigger>
      <TooltipPopup side="bottom" role="tooltip" id={`${triggerId}-tooltip`}>
        <div className="text-wrap text-2xs leading-relaxed">
          {status.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}
