import {
  createContext,
  useContext,
  useId,
  useMemo,
  useState,
  useRef,
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
  EnvironmentId,
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
  BotIcon,
} from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import { Button } from "../ui/button";
import { inboxSourceUrl, useInboxLink } from "./inboxSourceLink";
import { InboxSuggestionCallout, InboxSuggestionStatus } from "./InboxSuggestion";

import styles from "./inboxNotificationContent.module.css";
import { InboxImage } from "./InboxImage";
import { useInboxLinearAgentThread } from "./useInboxLinearAgentThread";

const SlackImageContext = createContext<{
  environmentId: EnvironmentId;
  notification: InboxNotification;
} | null>(null);

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

/** Hide the connector's standalone envelope lines; keep ordinary body text and greetings. */
function emailDisplayBody(content: string) {
  const labeledEnvelope = content.match(
    /^(?:Email:?\r?\n)?From:[^\n]+\r?\nTimestamp \(UTC\):\s*([^\r\n]+)\r?\n(?:\r?\n)?/i,
  );
  if (labeledEnvelope && !Number.isNaN(Date.parse(labeledEnvelope[1]!)))
    content = content.slice(labeledEnvelope[0].length);
  const lines = content.split(/\r?\n/);
  return lines
    .filter((line, index) => {
      if (index > 0 && lines[index - 1]!.trim() !== "") return true;
      const envelope = line.match(
        /^.+ · (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))\s*$/,
      );
      return !envelope || Number.isNaN(Date.parse(envelope[1]!));
    })
    .join("\n")
    .trim();
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

function InboxBlockquote({ children }: { children?: ReactNode }) {
  return <blockquote className={styles.blockquote}>{children}</blockquote>;
}

/** Plain bodies keep their literal text and links, with line-prefixed email-style quotations. */
function InboxQuotedText({ text }: { text: string }) {
  const blocks: { start: number; quoted: boolean; lines: string[] }[] = [];
  let offset = 0;
  for (const line of text.split(/\r?\n/)) {
    const quote = line.match(/^ {0,3}>[ \t]?(.*)$/);
    const quoted = quote !== null;
    let block = blocks.at(-1);
    if (!block || block.quoted !== quoted) {
      block = { start: offset, quoted, lines: [] };
      blocks.push(block);
    }
    block.lines.push(quote?.[1] ?? line);
    offset += line.length + 1;
  }
  return blocks.map((block) =>
    block.quoted ? (
      <InboxBlockquote key={block.start}>
        <InboxLinkedText text={block.lines.join("\n")} />
      </InboxBlockquote>
    ) : (
      <InboxLinkedText key={block.start} text={block.lines.join("\n")} />
    ),
  );
}

/** Stored Slack Markdown escapes >; restore quote runs without touching fenced code. */
function slackBlockquotes(content: string) {
  const lines: string[] = [];
  let inCode = false;
  let quoting = false;
  for (const line of content.split(/\r?\n/)) {
    const quote = !inCode && line.match(/^( {0,3})((?:\\?>)+)([ \t]?)(.*)$/);
    if (quote) {
      if (!quoting && lines.at(-1)?.trim()) lines.push("");
      lines.push(`${quote[1]}${quote[2]!.replaceAll("\\", "")}${quote[3]}${quote[4]}`);
    } else {
      // Slack quotes only marked lines; an unmarked reply must not become a lazy continuation.
      if (quoting && line.trim()) lines.push("");
      lines.push(line);
    }
    quoting = !!quote;
    if ((line.match(/(?<!\\)```/g)?.length ?? 0) % 2 === 1) inCode = !inCode;
  }
  return lines.join("\n");
}

const inboxMarkdownComponents: Components = { a: InboxMarkdownLink, blockquote: InboxBlockquote };
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
        {slackBlockquotes(content)}
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
  notification,
  environmentId,
}: {
  issue: InboxLinearIssue;
  onLoadPrevious?: LoadComments | undefined;
  notification: InboxNotification;
  environmentId?: EnvironmentId | undefined;
}) {
  const [loaded, setLoaded] = useState<InboxLinearIssue | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const historyId = useId();
  const section = useRef<HTMLDivElement>(null);
  const target = notification.items.at(-1)?.replyTarget;
  const commentId = target?.source === "linear" ? target.parentId : null;
  const issue = useMemo(() => {
    if (!loaded || initial.commentsComplete) return initial;
    // Older history enriches the current snapshot; it must not mask accepted replies.
    const comments = [
      ...new Map(
        [...loaded.comments, ...initial.comments].map((comment) => [comment.id, comment]),
      ).values(),
    ].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
    return {
      ...loaded,
      ...initial,
      comments,
      commentsComplete: loaded.commentsComplete,
      commentCount: Math.max(loaded.commentCount ?? 0, initial.commentCount ?? 0, comments.length),
    };
  }, [initial, loaded]);
  const initialIdentity =
    issue.comments.find((comment) => comment.id === commentId)?.agentThread ??
    issue.comments.find((comment) => comment.agentThread?.rootCommentId === commentId)?.agentThread;
  const { thread: agentThread, working } = useInboxLinearAgentThread({
    environmentId,
    projectId: notification.projectId,
    notificationId: notification.id,
    commentId,
    initialIdentity,
    element: section,
  });
  const comments = issue.comments.filter((comment) => !comment.isArtificialAgentSessionRoot);
  const commentCount = issue.commentsComplete
    ? comments.length
    : issue.commentCount === undefined
      ? undefined
      : Math.max(comments.length, issue.commentCount - (issue.hiddenCommentCount ?? 0));
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
    <div className={`${styles.slackContent} ${styles.linearContent}`}>
      <div className="mb-3">
        <strong>{issue.title}</strong>
      </div>
      {issue.description && (
        <section className="mb-4" aria-label="Issue description">
          <div className={styles.slackLabel}>Issue description</div>
          <InboxContentPreview lines={8}>
            <LinearMarkdown content={issue.description} />
          </InboxContentPreview>
        </section>
      )}
      <section className={styles.slackSection} aria-label="Comments">
        <div
          ref={section}
          className={`${styles.slackLabel} ${styles.linearCommentsHeader}`}
          data-agent-thread={!!agentThread}
        >
          <div className={styles.linearCommentsHeading}>
            <span className={styles.slackThreadTitle}>
              Comments
              {commentCount !== undefined && <span>· {commentCount}</span>}
            </span>
            {agentThread && (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <span
                      className={styles.linearAgentThread}
                      role="status"
                      tabIndex={0}
                      aria-label={`Agent thread with ${agentThread.agentName}${working ? ", working" : ""}`}
                    />
                  }
                >
                  <BotIcon aria-hidden="true" />
                  <span className={styles.linearAgentThreadLabel}>Agent</span>
                  <span aria-hidden="true">·</span>
                  <span className={styles.linearAgentName}>{agentThread.agentName}</span>
                  {working && <span className={styles.linearAgentWorking} aria-hidden="true" />}
                </TooltipTrigger>
                <TooltipPopup>
                  {agentThread.agentName}
                  {working ? " is working" : " agent session"}
                </TooltipPopup>
              </Tooltip>
            )}
          </div>
          {(!issue.commentsComplete || comments.length > 1) && (
            <Tooltip>
              <TooltipTrigger
                render={
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
                  />
                }
              >
                {pending ? "Loading…" : error ? "Retry" : expanded ? "Latest only" : "Show all"}
                <ChevronDownIcon aria-hidden />
              </TooltipTrigger>
              <TooltipPopup>
                {expanded ? "Show latest comment only" : "Show all issue comments"}
              </TooltipPopup>
            </Tooltip>
          )}
        </div>
        {error && (
          <p role="alert" className="mb-3 text-2xs text-destructive">
            {error}
          </p>
        )}
        <ol id={historyId} className={styles.slackTimeline}>
          {(expanded ? comments : comments.slice(-1)).map((comment) => {
            const agent =
              comment.authorIsAgent ||
              (!!comment.authorId && comment.authorId === agentThread?.agentId);
            return (
              <li key={comment.id} className={styles.slackReply} data-linear-comment={comment.id}>
                <span
                  className={`${styles.slackAvatar}${agent ? ` ${styles.linearAgentAvatar}` : ""}`}
                  aria-hidden={agent ? undefined : true}
                  role={agent ? "img" : undefined}
                  aria-label={agent ? `${comment.author} (agent)` : undefined}
                >
                  {agent ? (
                    <BotIcon aria-hidden="true" />
                  ) : (
                    comment.author
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((name) => name[0])
                      .join("")
                  )}
                </span>
                <div className={styles.slackAuthor}>
                  <span>{comment.author}</span>
                  <InboxTimestampLabel timestamp={comment.occurredAt} />
                </div>
                <InboxContentPreview lines={4}>
                  <LinearMarkdown content={comment.body} />
                </InboxContentPreview>
              </li>
            );
          })}
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
  suggestionsEnabled = false,
  onRetrySuggestion,
  threadRef,
}: {
  notification: InboxNotification;
  threadRef?: ScopedThreadRef | null | undefined;
  enabled: boolean;
  expanded?: boolean;
  suggestionsEnabled?: boolean;
  onRetrySuggestion?: (() => void) | undefined;
}) {
  const openLink = useInboxLink(threadRef);
  const suggestions = useMemo(
    () => notification.analysis?.suggestions.filter((text) => text.trim()) ?? [],
    [notification.analysis?.suggestions],
  );
  const suggestionStatus =
    notification.suggestionResearch?.status ?? (suggestions.length ? "ready" : undefined);
  return (
    <InboxLinkContext value={openLink}>
      <div className="min-w-0 flex-1 text-xs leading-relaxed">
        {enabled && notification.analysis?.summary ? (
          <div className="border-l-2 border-primary/30 pl-2.5">
            <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs font-normal text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <SparklesIcon className="size-3" />
                AI summary
              </span>
              {suggestionsEnabled && (
                <InboxSuggestionStatus status={suggestionStatus} onRetry={onRetrySuggestion} />
              )}
            </div>
            <div className={`whitespace-pre-wrap break-words ${expanded ? "" : "line-clamp-3"}`}>
              <InboxQuotedText text={notification.analysis.summary} />
            </div>
            <InboxSuggestionCallout
              visible={
                expanded &&
                suggestionsEnabled &&
                suggestionStatus === "ready" &&
                (suggestions.length > 0 || !!notification.analysis?.replyDraft)
              }
              suggestions={suggestions}
              hasDraft={!!notification.analysis?.replyDraft}
            >
              {(content) => (
                <ul className="space-y-2">
                  {content.map((suggestion) => (
                    <li key={suggestion}>
                      <InboxQuotedText text={suggestion} />
                    </li>
                  ))}
                </ul>
              )}
            </InboxSuggestionCallout>
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
  const imageContext = useContext(SlackImageContext);
  return (
    <div
      className={`${styles.messageMarkdown} [&_pre]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4`}
    >
      <SlackMarkdown content={message.formattedContent} mentions={message.slackMentions} />
      {imageContext && !!message.images?.length && (
        <div className="grid grid-cols-[repeat(2,4rem)] gap-2">
          {message.images.map((image) =>
            image.url ? (
              <InboxImage
                key={image.id}
                environmentId={imageContext.environmentId}
                name={image.name}
                resource={{
                  _tag: "slack-image",
                  projectId: imageContext.notification.projectId,
                  notificationId: imageContext.notification.id,
                  fileId: image.id,
                }}
              />
            ) : (
              <p key={image.id} role="status" className="col-span-2 text-2xs text-muted-foreground">
                Sent image: {image.name}. Preview pending.
              </p>
            ),
          )}
        </div>
      )}
    </div>
  );
}
function SlackThreadContent({
  thread: initial,
  onLoadPrevious,
  sourceAuthor,
  viewerUserId,
}: {
  viewerUserId: string | undefined;
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
  const authorLabel = (message: InboxSlackMessage) =>
    viewerUserId && (message.authorId ?? message.author) === viewerUserId ? "me" : message.author;
  const replies = [...thread.messages, ...(thread.pendingMessages ?? [])].filter(
    (message) => message.ts !== thread.ts,
  );
  const replyCount =
    thread.replyCount === null ? null : thread.replyCount + (thread.pendingMessages?.length ?? 0);
  const latest =
    thread.pendingMessages?.at(-1) ??
    replies.find((message) => message.ts === thread.latestReplyTs);
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
          {thread.root.author !== sourceAuthor && <span>{authorLabel(thread.root)}</span>}
        </div>
        <SlackMessageBody message={thread.root} />
      </section>
      {latest && (
        <section aria-label="Thread" className={styles.slackSection}>
          <div className={styles.slackLabel}>
            <span className={styles.slackThreadTitle}>
              Thread
              {replyCount !== null && (
                <span>
                  · {replyCount} {replyCount === 1 ? "reply" : "replies"}
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
                  {authorLabel(message)
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((name) => name[0])
                    .join("")}
                </span>
                <div className={styles.slackAuthor}>
                  <span>{authorLabel(message)}</span>
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
  environmentId,
  threadRef,
  onLoadPrevious,
}: {
  notification: InboxNotification;
  environmentId?: EnvironmentId | undefined;
  threadRef?: ScopedThreadRef | null | undefined;
  onLoadPrevious?: LoadComments | undefined;
}) {
  const openLink = useInboxLink(threadRef);
  const imageContext = useMemo(
    () => (environmentId ? { environmentId, notification } : null),
    [environmentId, notification],
  );
  if (notification.source === "superhuman") {
    return (
      <InboxLinkContext value={openLink}>
        <div className={styles.slackContent}>
          {notification.items.map((item) => (
            <section
              key={item.id}
              className={styles.slackSection}
              aria-label={item.title || "Email"}
            >
              <p className="mb-3">
                <strong>{item.title}</strong>
              </p>
              <InboxContentPreview lines={8}>
                <div className="whitespace-pre-wrap break-words">
                  <InboxQuotedText text={emailDisplayBody(item.content)} />
                </div>
              </InboxContentPreview>
            </section>
          ))}
        </div>
      </InboxLinkContext>
    );
  }
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
            notification={notification}
            environmentId={environmentId}
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
        <SlackImageContext value={imageContext}>
          <SlackThreadContent
            key={`${notification.id}:${thread.ts}:${thread.latestReplyTs}`}
            thread={thread}
            viewerUserId={notification.connectionId.split(":")[1]}
            sourceAuthor={notification.items.at(-1)?.author}
            onLoadPrevious={onLoadPrevious}
          />
        </SlackImageContext>
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
                      : `${styles.messageMarkdown} [&_a]:text-primary [&_a]:underline [&_pre]:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4`
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
                <div className="whitespace-pre-wrap break-words">
                  <InboxQuotedText text={item.content} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </InboxLinkContext>
  );
}
