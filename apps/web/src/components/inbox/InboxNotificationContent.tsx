import { createContext, useContext, type ComponentProps } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { slackLinkUrl } from "@t3tools/shared/slackText";
import type { InboxNotification, ScopedThreadRef } from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { ArrowUpRightIcon, SparklesIcon } from "lucide-react";
import { Button } from "../ui/button";
import { inboxSourceUrl, useInboxLink } from "./inboxSourceLink";

const inboxMarkdownPlugins = [remarkGfm];

const InboxLinkContext = createContext<ReturnType<typeof useInboxLink> | null>(null);
function InboxMarkdownLink({ href, children }: ComponentProps<"a">) {
  const openLink = useContext(InboxLinkContext);
  return href ? (
    <a
      href={href}
      rel="noreferrer noopener"
      target="_blank"
      onClick={(event) => {
        event.stopPropagation();
        event.preventDefault();
        openLink?.(href, event);
      }}
    >
      {children}
    </a>
  ) : (
    <>{children}</>
  );
}
const inboxMarkdownComponents: Components = { a: InboxMarkdownLink };

export function InboxOpenOriginalAction({
  notification,
  shortcut = false,
  hints = false,
  threadRef,
}: {
  notification: InboxNotification;
  threadRef?: ScopedThreadRef | null | undefined;
  shortcut?: boolean;
  hints?: boolean;
}) {
  const openLink = useInboxLink(threadRef);
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
        onClick={(event) => {
          const url = inboxSourceUrl(notification);
          if (url) openLink(url, event);
        }}
      >
        <ArrowUpRightIcon className="size-3.5" />
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
              AI summary not available
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function InboxSourceContent({
  notification,
  threadRef,
}: {
  notification: InboxNotification;
  threadRef?: ScopedThreadRef | null | undefined;
}) {
  const openLink = useInboxLink(threadRef);
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
            {item.formattedContent !== undefined ? (
              <div className="space-y-2 whitespace-pre-wrap break-words [&_a]:text-primary [&_a]:underline [&_pre]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4">
                <InboxLinkContext value={openLink}>
                  <ReactMarkdown
                    skipHtml
                    remarkPlugins={inboxMarkdownPlugins}
                    allowedElements={[
                      "p",
                      "a",
                      "strong",
                      "em",
                      "del",
                      "code",
                      "pre",
                      "blockquote",
                      "ul",
                      "ol",
                      "li",
                      "br",
                    ]}
                    unwrapDisallowed
                    urlTransform={(url) => slackLinkUrl(url) ?? ""}
                    components={inboxMarkdownComponents}
                  >
                    {item.formattedContent}
                  </ReactMarkdown>
                </InboxLinkContext>
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words">{item.content}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
