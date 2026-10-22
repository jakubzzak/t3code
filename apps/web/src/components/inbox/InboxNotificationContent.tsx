import type { InboxNotification } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { ExternalLinkIcon, SparklesIcon } from "lucide-react";
import { Button } from "../ui/button";
import { inboxSourceUrl, openInboxOriginal } from "./inboxSourceLink";

export function InboxOpenOriginalAction({
  notification,
  shortcut = false,
  hints = false,
}: {
  notification: InboxNotification;
  shortcut?: boolean;
  hints?: boolean;
}) {
  const mac = isMacPlatform(typeof navigator === "undefined" ? "" : navigator.platform);
  return (
    <span className="relative">
      <Button
        size="icon-xs"
        variant="ghost"
        disabled={!inboxSourceUrl(notification)}
        aria-label="Open original"
        aria-keyshortcuts={shortcut ? `${mac ? "Meta" : "Control"}+Shift+O` : undefined}
        title={shortcut ? `Open original (${mac ? "⌘⇧O" : "Ctrl+Shift+O"})` : "Open original"}
        onClick={() => openInboxOriginal(notification)}
      >
        <ExternalLinkIcon className="size-3.5" />
      </Button>
      {shortcut && hints && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-2 right-0 rounded bg-popover px-1 text-3xs text-popover-foreground shadow-sm"
        >
          ⇧O
        </span>
      )}
    </span>
  );
}

export function InboxSummary({
  notification,
  enabled,
  expanded = false,
}: {
  notification: InboxNotification;
  enabled: boolean;
  expanded?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1 text-xs leading-relaxed">
      {enabled && notification.analysis?.summary ? (
        <div className="border-l-2 border-primary/30 pl-2.5">
          <div className="mb-1 flex items-center gap-1 text-2xs font-normal text-muted-foreground">
            <SparklesIcon className="size-3" />
            AI summary
          </div>
          <p className={`whitespace-pre-wrap break-words ${expanded ? "" : "line-clamp-3"}`}>
            {notification.analysis.summary}
          </p>
          {expanded && notification.analysis.suggestions.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 font-medium">Suggested next steps</p>
              <ul className="list-disc space-y-1 pl-4">
                {notification.analysis.suggestions.map((suggestion) => (
                  <li key={suggestion}>{suggestion}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <>
          <p>{notification.items.at(-1)?.title}</p>
          {enabled && (
            <p className="mt-1 text-2xs font-normal text-muted-foreground">
              {notification.processingError ?? "AI summary pending"}
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function InboxSourceContent({ notification }: { notification: InboxNotification }) {
  return (
    <div className="space-y-3 py-2 text-xs leading-relaxed">
      <div className="space-y-3 border-t border-border/50 pt-2">
        <p className="text-2xs text-muted-foreground">Original message</p>
        {notification.items.map((item, index) => (
          <div key={item.id}>
            {index < notification.items.length - 1 && (
              <div className="mb-1 text-2xs text-muted-foreground">
                {item.author} · {item.location}
              </div>
            )}
            <p className="whitespace-pre-wrap break-words">{item.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
