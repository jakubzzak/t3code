import type { InboxNotification } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { useId, useState } from "react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

function Indicator({ label, lines, tone }: { label: string; lines: string[]; tone: string }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <Tooltip triggerId={id} open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        id={id}
        closeOnClick={false}
        render={
          <span
            tabIndex={0}
            role="img"
            className="flex h-3.5 w-2 items-center justify-center rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          />
        }
        aria-label={label}
        aria-describedby={open ? `${id}-tooltip` : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
      >
        <span aria-hidden className={`size-1.5 rounded-full ${tone}`} />
      </TooltipTrigger>
      <TooltipPopup side="bottom" role="tooltip" id={`${id}-tooltip`} hoverable>
        <div className="text-wrap text-2xs leading-relaxed">
          {lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

/** Independent status dots share the integration-status disclosure treatment. */
export function InboxNotificationIndicators({ notification }: { notification: InboxNotification }) {
  const { relevance, state, replyCursor } = notification;
  const mac = isMacPlatform(typeof navigator === "undefined" ? "" : navigator.platform);
  const shortcut = mac ? "⌘I" : "Ctrl+I";
  const assessment = relevance?.status === "complete" ? relevance : null;
  const manual = state.irrelevant;
  const confidence = assessment?.confidence;
  const irrelevant = manual === true || (manual === undefined && assessment?.irrelevant);
  const possible = manual === undefined && !irrelevant && confidence != null && confidence >= 75;
  const label =
    manual === true
      ? "Marked irrelevant by you"
      : irrelevant
        ? "Irrelevant"
        : "Possibly irrelevant";
  return (
    <span className="mt-0.5 flex w-2 shrink-0 flex-col items-center" data-inbox-indicators>
      {!state.read && <Indicator label="Unread" lines={["Unread"]} tone="bg-primary" />}
      {(irrelevant || possible) && (
        <Indicator
          label={label}
          lines={[
            manual === true ? label : `${label} · ${confidence}% confidence`,
            `${shortcut} · ${manual === true ? "Keep relevant" : "Mark irrelevant"}`,
          ]}
          tone={
            irrelevant
              ? "bg-amber-300 ring-1 ring-black/40 dark:ring-white/15"
              : "border border-amber-300"
          }
        />
      )}
      {replyCursor?.isSelf && replyCursor.kind !== "update" && (
        <Indicator
          label="Your last reply"
          lines={["Your last reply"]}
          tone="border border-violet-400"
        />
      )}
    </span>
  );
}
