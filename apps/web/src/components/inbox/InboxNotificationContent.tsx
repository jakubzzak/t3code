import {
  createContext,
  useContext,
  useId,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { find } from "linkifyjs";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { slackLinkUrl, slackMentionHref } from "@t3tools/shared/slackText";
import { InboxTimestampLabel } from "./InboxTimestampLabel";
import { InboxContentPreview } from "./InboxContentPreview";
import type {
  InboxNotification,
  ScopedThreadRef,
  InboxSlackThread,
  InboxSlackMessage,
  InboxSlackMention,
  InboxLinearIssue,
} from "@t3tools/contracts";
import { isMacPlatform } from "@t3tools/shared/keybindings";
import {
  ArrowUpRightIcon,
  ChevronDownIcon,
  SparklesIcon,
  UserRoundIcon,
  UsersRoundIcon,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { Button } from "../ui/button";
import { inboxSourceUrl, useInboxLink } from "./inboxSourceLink";

import styles from "./inboxNotificationContent.module.css";

const inboxMarkdownPlugins = [remarkGfm];

const InboxLinkContext = createContext<ReturnType<typeof useInboxLink> | null>(null);
const emptySlackMentions: ReadonlyArray<InboxSlackMention> = [];
const SlackMentionsContext = createContext(emptySlackMentions);
function InboxMarkdownLink({ href, children }: ComponentProps<"a">) {
  const openLink = useContext(InboxLinkContext);
  const mentions = useContext(SlackMentionsContext);
  const mention = mentions.find((entry) => slackMentionHref(entry) === href);
  if (mention) {
    const Icon = mention.kind === "user" ? UserRoundIcon : UsersRoundIcon;
    return (
      <Tooltip>
        <TooltipTrigger
          render={
            <span
              className={styles.slackMention}
              data-personal={mention.personal}
              data-slack-mention={`${mention.kind}:${mention.id}`}
            />
          }
        >
          <Icon aria-hidden />
          <span>@{mention.label}</span>
        </TooltipTrigger>
        <TooltipPopup>
          {mention.kind === "group"
            ? mention.personal
              ? "Group you belong to"
              : "Slack group"
            : mention.personal
              ? "You"
              : "Slack member"}
        </TooltipPopup>
      </Tooltip>
    );
  }
  if (href?.startsWith("slack-mention:")) return <>{children}</>;
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
const inlineSlackMarkdownComponents: Components = {
  ...inboxMarkdownComponents,
  p: ({ children }) => <span>{children}</span>,
};
function SlackMarkdown({
  content,
  mentions = emptySlackMentions,
  inline = false,
}: {
  content: string;
  mentions?: ReadonlyArray<InboxSlackMention> | undefined;
  inline?: boolean;
}) {
  return (
    <SlackMentionsContext value={mentions}>
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
        urlTransform={(url) =>
          mentions.some((entry) => slackMentionHref(entry) === url)
            ? url
            : (slackLinkUrl(url) ?? "")
        }
        components={inline ? inlineSlackMarkdownComponents : inboxMarkdownComponents}
      >
        {content}
      </ReactMarkdown>
    </SlackMentionsContext>
  );
}

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
function LinearMarkdown({ content }: { content: string }) {
  return (
    <div className={styles.linearMarkdown}>
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
        ]}
        unwrapDisallowed
        urlTransform={(url) => slackLinkUrl(url) ?? ""}
        components={linearMarkdownComponents}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

type LoadComments = () => Promise<InboxSlackThread | InboxLinearIssue>;

function LinearIssueContent({
  issue: initial,
  onLoadPrevious,
}: {
  issue: InboxLinearIssue;
  onLoadPrevious?: LoadComments | undefined;
}) {
  const [loaded, setLoaded] = useState<InboxLinearIssue | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const historyId = useId();
  const issue = loaded ?? initial;
  const comments = issue.comments;
  async function toggle() {
    if (expanded) {
      setExpanded(false);
      return;
    }
    if (issue.commentsComplete || !onLoadPrevious) {
      setExpanded(true);
      return;
    }
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const result = await onLoadPrevious();
      if (!("description" in result)) throw new Error("Issue comments could not be loaded.");
      setLoaded(result);
      setExpanded(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load issue comments.");
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={styles.slackContent}>
      <div className="mb-3 font-medium">{issue.title}</div>
      {issue.description && (
        <section className={styles.slackSection} aria-label="Issue description">
          <div className={styles.slackLabel}>Issue description</div>
          <InboxContentPreview lines={8}>
            <LinearMarkdown content={issue.description} />
          </InboxContentPreview>
        </section>
      )}
      <section className={styles.slackSection} aria-label="Comments">
        <div className={styles.slackLabel}>
          <span className={styles.slackThreadTitle}>
            Comments{issue.commentsComplete && <span>· {comments.length}</span>}
          </span>
          {(!issue.commentsComplete || comments.length > 1) && (
            <button
              type="button"
              className={styles.previousComments}
              disabled={pending}
              aria-expanded={expanded}
              aria-controls={historyId}
              aria-busy={pending}
              aria-label={expanded ? "Show latest comment only" : "Show all issue comments"}
              onClick={(event) => {
                event.stopPropagation();
                void toggle();
              }}
            >
              {pending ? "Loading…" : error ? "Retry" : expanded ? "Latest only" : "Show all"}
              <ChevronDownIcon aria-hidden />
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="mb-3 text-2xs text-destructive">
            {error}
          </p>
        )}
        <ol id={historyId} className={styles.slackTimeline}>
          {(expanded ? comments : comments.slice(-1)).map((comment) => (
            <li key={comment.id} className={styles.slackReply} data-linear-comment={comment.id}>
              <span aria-hidden className={styles.slackAvatar}>
                {comment.author
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((name) => name[0])
                  .join("")}
              </span>
              <div className={styles.slackAuthor}>
                <span>{comment.author}</span>
                <InboxTimestampLabel timestamp={comment.occurredAt} />
              </div>
              <InboxContentPreview lines={4}>
                <LinearMarkdown content={comment.body} />
              </InboxContentPreview>
            </li>
          ))}
        </ol>
        {issue.commentsComplete && comments.length === 0 && (
          <p className="text-2xs text-muted-foreground">No comments yet.</p>
        )}
      </section>
    </div>
  );
}

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
            <div>
              {notification.source === "slack" && notification.items.at(-1)?.formattedTitle ? (
                <SlackMarkdown
                  content={notification.items.at(-1)!.formattedTitle!}
                  mentions={notification.items.at(-1)?.slackMentions}
                  inline
                />
              ) : (
                <InboxLinkedText text={notification.items.at(-1)?.title ?? ""} />
              )}
            </div>
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
      <SlackMarkdown content={message.formattedContent} mentions={message.slackMentions} />
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
  onLoadPrevious?: LoadComments | undefined;
}) {
  const [loaded, setLoaded] = useState<InboxSlackThread | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const historyId = useId();
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
      const result = await onLoadPrevious();
      if (!("channelId" in result)) throw new Error("Thread comments could not be loaded.");
      setLoaded(result);
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
            <span className={styles.slackThreadTitle}>
              Thread
              {thread.replyCount !== null && (
                <span>
                  · {thread.replyCount} {thread.replyCount === 1 ? "reply" : "replies"}
                </span>
              )}
            </span>
            {hasPrevious && (
              <button
                type="button"
                className={styles.previousComments}
                onClick={() => void toggle()}
                disabled={pending || (!!thread.nextCursor && !onLoadPrevious)}
                aria-expanded={expanded}
                aria-controls={historyId}
                aria-busy={pending}
                aria-label={
                  pending
                    ? "Loading previous comments"
                    : error
                      ? "Retry loading previous comments"
                      : expanded
                        ? "Show latest reply only"
                        : "Show all thread replies"
                }
              >
                {pending ? "Loading…" : error ? "Retry" : expanded ? "Latest only" : "Show all"}
                <ChevronDownIcon aria-hidden />
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="mb-3 text-2xs text-destructive">
              {error}
            </p>
          )}
          <ol id={historyId} className={styles.slackTimeline}>
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
                  <InboxTimestampLabel timestamp={message.occurredAt} />
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
  onLoadPrevious?: LoadComments | undefined;
}) {
  const openLink = useInboxLink(threadRef);
  if (notification.source === "linear") {
    const issue =
      notification.linearIssue ??
      notification.items.findLast((item) => item.linearIssue)?.linearIssue;
    if (issue) {
      const comments = notification.linearIssue?.commentsComplete
        ? notification.linearIssue.comments
        : [
            ...new Map(
              notification.items
                .flatMap((item) => item.linearIssue?.comments ?? [])
                .concat(issue.comments)
                .map((comment) => [comment.id, comment]),
            ).values(),
          ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
      return (
        <InboxLinkContext value={openLink}>
          <LinearIssueContent
            key={`${notification.id}:${notification.analysisVersion}`}
            issue={{ ...issue, comments }}
            onLoadPrevious={onLoadPrevious}
          />
        </InboxLinkContext>
      );
    }
    return (
      <InboxLinkContext value={openLink}>
        <div className={styles.slackContent}>
          <div className={styles.slackLabel}>Original message</div>
          <InboxContentPreview lines={8}>
            <LinearMarkdown content={notification.items.map((item) => item.content).join("\n\n")} />
          </InboxContentPreview>
        </div>
      </InboxLinkContext>
    );
  }
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
              {item.source === "slack" && item.formattedContent !== undefined ? (
                <SlackMessageBody
                  message={{ ...item, ts: item.id, formattedContent: item.formattedContent }}
                />
              ) : item.source === "linear" || item.formattedContent !== undefined ? (
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
