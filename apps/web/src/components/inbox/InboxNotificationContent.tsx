import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { find } from "linkifyjs";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { slackLinkUrl } from "@t3tools/shared/slackText";
import { useClientSettings } from "~/hooks/useSettings";
import { formatCompactTimestamp, formatChatTimestampTooltip } from "~/timestampFormat";
import type {
  InboxNotification,
  ScopedThreadRef,
  InboxSlackThread,
  InboxSlackMessage,
} from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import { ArrowUpRightIcon, SparklesIcon } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { Button } from "../ui/button";
import { inboxSourceUrl, useInboxLink } from "./inboxSourceLink";

import styles from "./inboxNotificationContent.module.css";

const inboxMarkdownPlugins = [remarkGfm];

const InboxLinkContext = createContext<ReturnType<typeof useInboxLink> | null>(null);
function InboxMarkdownLink({ href, children }: ComponentProps<"a">) {
  const openLink = useContext(InboxLinkContext);
  return href ? (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={href}
            className="text-primary underline"
            rel="noreferrer noopener"
            target="_blank"
            onClick={(event) => {
              event.stopPropagation();
              event.preventDefault();
              openLink?.(href, event);
            }}
          />
        }
      >
        {typeof children === "string" &&
        children.replace(/^https?:\/\//i, "").replace(/\/$/, "") ===
          href.replace(/^https?:\/\//i, "").replace(/\/$/, "")
          ? compactInboxUrl(href)
          : children}
      </TooltipTrigger>
      <TooltipPopup>{href}</TooltipPopup>
    </Tooltip>
  ) : (
    <>{children}</>
  );
}
function compactInboxUrl(url: string) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.hostname.replace(/^www\./i, "") : url;
  } catch {
    return url;
  }
}

/** Add links without treating plain notification text as Markdown or HTML. */
function InboxLinkedText({ text }: { text: string }) {
  return useMemo(() => {
    const nodes: ReactNode[] = [];
    let offset = 0;
    for (const match of find(text, "url", { defaultProtocol: "https" })) {
      const href = slackLinkUrl(match.href);
      if (!href) continue;
      nodes.push(text.slice(offset, match.start));
      nodes.push(
        <InboxMarkdownLink key={match.start} href={href}>
          {compactInboxUrl(href)}
        </InboxMarkdownLink>,
      );
      offset = match.end;
    }
    nodes.push(text.slice(offset));
    return nodes;
  }, [text]);
}

const inboxMarkdownComponents: Components = { a: InboxMarkdownLink };

function InboxMarkdownImage({ src, alt }: ComponentProps<"img">) {
  return typeof src === "string" && src ? (
    <InboxMarkdownLink href={src}>{alt || "View image"}</InboxMarkdownLink>
  ) : (
    <>{alt}</>
  );
}
const linearMarkdownComponents: Components = {
  ...inboxMarkdownComponents,
  img: InboxMarkdownImage,
};

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
  threadRef,
}: {
  notification: InboxNotification;
  threadRef?: ScopedThreadRef | null | undefined;
  enabled: boolean;
  expanded?: boolean;
}) {
  const openLink = useInboxLink(threadRef);
  return (
    <InboxLinkContext value={openLink}>
      <div className="min-w-0 flex-1 text-xs leading-relaxed">
        {enabled && notification.analysis?.summary ? (
          <div className="border-l-2 border-primary/30 pl-2.5">
            <div className="mb-1 flex items-center gap-1 text-2xs font-normal text-muted-foreground">
              <SparklesIcon className="size-3" />
              AI summary
            </div>
            <p className={`whitespace-pre-wrap break-words ${expanded ? "" : "line-clamp-3"}`}>
              <InboxLinkedText text={notification.analysis.summary} />
            </p>
            {expanded && notification.analysis.suggestions.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 font-medium">Suggested next steps</p>
                <ul className="list-disc space-y-1 pl-4">
                  {notification.analysis.suggestions.map((suggestion) => (
                    <li key={suggestion}>
                      <InboxLinkedText text={suggestion} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <>
            <p>
              <InboxLinkedText text={notification.items.at(-1)?.title ?? ""} />
            </p>
            {enabled && (
              <p className="mt-1 text-2xs font-normal text-muted-foreground">
                AI summary not available
              </p>
            )}
          </>
        )}
      </div>
    </InboxLinkContext>
  );
}

function SlackMessageBody({ message }: { message: InboxSlackMessage }) {
  return (
    <div className="space-y-2 whitespace-pre-wrap break-words [&_pre]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4">
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
        {message.formattedContent}
      </ReactMarkdown>
    </div>
  );
}
function SlackThreadContent({
  thread: initial,
  onLoadPrevious,
  sourceAuthor,
}: {
  sourceAuthor?: string | undefined;
  thread: InboxSlackThread;
  onLoadPrevious?: (() => Promise<InboxSlackThread>) | undefined;
}) {
  const [loaded, setLoaded] = useState<InboxSlackThread | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const thread = loaded ?? initial;
  const replies = thread.messages.filter((message) => message.ts !== thread.ts);
  const latest = replies.find((message) => message.ts === thread.latestReplyTs);
  const older = replies.filter((message) => message.ts !== latest?.ts);
  const hasPrevious =
    older.length > 0 ||
    !!thread.nextCursor ||
    (thread.replyCount !== null && thread.replyCount > 1);
  async function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (!thread.nextCursor) {
      setExpanded(true);
      return;
    }
    if (!onLoadPrevious || pending) return;
    setPending(true);
    setError(null);
    try {
      setLoaded(await onLoadPrevious());
      setExpanded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load previous comments.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={styles.slackContent}>
      <section aria-label="Original message" className={styles.slackSection}>
        <div className={styles.slackLabel}>
          Original message{" "}
          {thread.root.author !== sourceAuthor && <span>{thread.root.author}</span>}
        </div>
        <SlackMessageBody message={thread.root} />
      </section>
      {latest && (
        <section aria-label="Thread" className={styles.slackSection}>
          <div className={styles.slackLabel}>
            Thread{" "}
            {thread.replyCount !== null && (
              <span>
                {thread.replyCount} {thread.replyCount === 1 ? "reply" : "replies"}
              </span>
            )}
          </div>
          {hasPrevious && (
            <button
              type="button"
              className={styles.previousComments}
              onClick={() => void toggle()}
              disabled={pending || (!!thread.nextCursor && !onLoadPrevious)}
              aria-expanded={expanded}
            >
              {pending
                ? "Loading previous comments…"
                : error
                  ? "Retry loading previous comments"
                  : expanded
                    ? "Hide previous comments"
                    : "Load previous comments"}
            </button>
          )}
          {error && (
            <p role="alert" className="mb-3 text-2xs text-destructive">
              {error}
            </p>
          )}
          <ol className={styles.slackTimeline}>
            {(expanded ? [...older, latest] : [latest]).map((message) => (
              <li key={message.ts} data-slack-reply={message.ts} className={styles.slackReply}>
                <span aria-hidden className={styles.slackAvatar}>
                  {message.author
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((name) => name[0])
                    .join("")}
                </span>
                <div className={styles.slackAuthor}>
                  <span>{message.author}</span>
                  <Tooltip>
                    <TooltipTrigger render={<time dateTime={message.occurredAt} />}>
                      {formatCompactTimestamp(message.occurredAt, timestampFormat)}
                    </TooltipTrigger>
                    <TooltipPopup>
                      {formatChatTimestampTooltip(message.occurredAt, timestampFormat)}
                    </TooltipPopup>
                  </Tooltip>
                </div>
                <SlackMessageBody message={message} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

export function InboxSourceContent({
  notification,
  threadRef,
  onLoadPrevious,
}: {
  notification: InboxNotification;
  threadRef?: ScopedThreadRef | null | undefined;
  onLoadPrevious?: (() => Promise<InboxSlackThread>) | undefined;
}) {
  const openLink = useInboxLink(threadRef);
  if (notification.source === "slack" && notification.slackThread) {
    const thread = notification.slackThread;
    return (
      <InboxLinkContext value={openLink}>
        <SlackThreadContent
          key={`${notification.id}:${thread.ts}:${thread.latestReplyTs}`}
          thread={thread}
          sourceAuthor={notification.items.at(-1)?.author}
          onLoadPrevious={onLoadPrevious}
        />
      </InboxLinkContext>
    );
  }
  return (
    <InboxLinkContext value={openLink}>
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
              {item.source === "linear" || item.formattedContent !== undefined ? (
                <div
                  className={
                    item.source === "linear"
                      ? styles.linearMarkdown
                      : "space-y-2 whitespace-pre-wrap break-words [&_a]:text-primary [&_a]:underline [&_pre]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4"
                  }
                >
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
                      ...(item.source === "linear"
                        ? [
                            "h1",
                            "h2",
                            "h3",
                            "h4",
                            "h5",
                            "h6",
                            "hr",
                            "table",
                            "thead",
                            "tbody",
                            "tr",
                            "th",
                            "td",
                            "input",
                            "img",
                          ]
                        : []),
                    ]}
                    unwrapDisallowed
                    urlTransform={(url) => slackLinkUrl(url) ?? ""}
                    components={
                      item.source === "linear" ? linearMarkdownComponents : inboxMarkdownComponents
                    }
                  >
                    {item.formattedContent ?? item.content}
                  </ReactMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap break-words">
                  <InboxLinkedText text={item.content} />
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </InboxLinkContext>
  );
}
