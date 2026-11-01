// @effect-diagnostics nodeBuiltinImport:off -- Pure stable source identity shared by ingestion and persistence.
import * as NodeCrypto from "node:crypto";
import * as NodeUtil from "node:util";
import type {
  InboxNotification,
  InboxReplyActivity,
  InboxSourceItem,
  InboxState,
  InboxSlackThread,
  ProjectId,
} from "@t3tools/contracts";

/** Native group identity is scoped to a connection and project, never inferred across sources. */
export function inboxIdentity(projectId: ProjectId, item: InboxSourceItem) {
  return NodeCrypto.createHash("sha256")
    .update(JSON.stringify([projectId, item.source, item.connectionId, item.groupId]))
    .digest("hex");
}
/** Retain already loaded history when incremental intake brings a newer thread snapshot. */
function mergeSlackHistory(previous: InboxSlackThread | undefined, incoming: InboxSlackThread) {
  if (!previous || previous.ts !== incoming.ts || previous.channelId !== incoming.channelId)
    return incoming;
  if (incoming.formatVersion === 2 && previous.formatVersion !== 2) return incoming;
  if (incoming.root.images !== undefined && previous.root.images === undefined) return incoming;
  if (
    previous.latestReplyTs &&
    incoming.latestReplyTs &&
    Number(previous.latestReplyTs) > Number(incoming.latestReplyTs)
  )
    return previous;
  if (
    previous.replyCount !== null &&
    incoming.replyCount !== null &&
    incoming.replyCount < previous.replyCount
  )
    return incoming;
  const messages = new Map(previous.messages.map((message) => [message.ts, message]));
  for (const message of incoming.messages) messages.set(message.ts, message);
  return {
    ...incoming,
    messages: [...messages.values()].sort((a, b) => Number(a.ts) - Number(b.ts)),
    nextCursor:
      incoming.replyCount !== null && messages.size >= incoming.replyCount
        ? null
        : previous.latestReplyTs === incoming.latestReplyTs &&
            previous.messages.length > incoming.messages.length
          ? previous.nextCursor
          : incoming.nextCursor,
  };
}
/** Match a confirmed upload to native history by Slack file identity, never by host time. */
function confirmedUploads(previous: InboxSlackThread | undefined, incoming: InboxSlackThread) {
  if (!previous || previous.channelId !== incoming.channelId || previous.ts !== incoming.ts)
    return [];
  const fileIds = new Set(
    previous.pendingMessages?.flatMap(
      (message) => message.images?.map((image) => image.id) ?? [],
    ) ?? [],
  );
  return incoming.messages.filter((message) =>
    message.images?.some((image) => fileIds.has(image.id)),
  );
}
export function confirmedSlackReplyCursor(
  previous: InboxSlackThread | undefined,
  incoming: InboxSlackThread,
) {
  return confirmedUploads(previous, incoming)
    .map((message) => ({
      id: `${incoming.channelId}:${message.ts}`,
      occurredAt: message.occurredAt,
      isSelf: true,
    }))
    .sort(compareReplyActivity)
    .at(-1);
}
/** Keep confirmed uploads visible until their native Slack messages arrive. */
export function mergeSlackThread(
  previous: InboxSlackThread | undefined,
  incoming: InboxSlackThread,
) {
  const merged = mergeSlackHistory(previous, incoming);
  if (
    !previous?.pendingMessages?.length ||
    previous.channelId !== incoming.channelId ||
    previous.ts !== incoming.ts
  )
    return merged;
  const confirmed = confirmedUploads(previous, incoming);
  const files = new Set(
    confirmed.flatMap((message) => message.images?.map((image) => image.id) ?? []),
  );
  const messages = new Map(merged.messages.map((message) => [message.ts, message]));
  for (const message of confirmed) messages.set(message.ts, message);
  return {
    ...merged,
    messages: [...messages.values()].sort((a, b) => Number(a.ts) - Number(b.ts)),
    pendingMessages: previous.pendingMessages.filter(
      (message) => !message.images?.some((image) => files.has(image.id)),
    ),
  };
}
/** Source timestamps determine attention order; IDs break ties and make replays inert. */
export function compareReplyActivity(a: InboxReplyActivity, b: InboxReplyActivity) {
  return Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.id.localeCompare(b.id);
}

export function ingestInboxItem(
  projectId: ProjectId,
  item: InboxSourceItem,
  previous?: InboxNotification,
): InboxNotification {
  const existing = previous?.items.find((candidate) => candidate.id === item.id);
  const incomingThread = item.slackThread;
  const { slackThread: _incomingThread, replyActivity, ...body } = item;
  const confirmed = incomingThread
    ? confirmedSlackReplyCursor(previous?.slackThread, incomingThread)
    : undefined;
  const acknowledged =
    confirmed &&
    (!previous?.replyCursor || compareReplyActivity(confirmed, previous.replyCursor) > 0)
      ? confirmed
      : previous?.replyCursor;
  const replies = replyActivity?.toSorted(compareReplyActivity) ?? [];
  const fresh = replies.filter((reply) =>
    acknowledged
      ? compareReplyActivity(reply, acknowledged) > 0
      : !previous || Date.parse(reply.occurredAt) > Date.parse(previous.updatedAt),
  );
  // Normal source sync may identify the actor of an already acknowledged notice.
  // Enrich the cursor without replaying read/settlement transitions or summary work.
  const observed =
    acknowledged && replies.find((reply) => compareReplyActivity(reply, acknowledged) === 0);
  const current =
    previous && observed?.kind && !NodeUtil.isDeepStrictEqual(observed, previous.replyCursor)
      ? { ...previous, replyCursor: observed, revision: previous.revision + 1 }
      : previous;
  const latestReply = fresh.at(-1);
  if (
    current &&
    existing &&
    !latestReply &&
    !confirmed &&
    Date.parse(item.occurredAt) < Date.parse(existing.occurredAt)
  )
    return current;
  const latestIncoming = fresh.findLast((reply) => !reply.isSelf);
  const replyCursor = latestReply ?? (observed?.kind ? observed : acknowledged);
  const thread = incomingThread
    ? mergeSlackThread(current?.slackThread, incomingThread)
    : current?.slackThread;
  const sameLatest =
    (current?.slackThread?.latestReplyTs ?? null) === (thread?.latestReplyTs ?? null);
  if (
    !latestReply &&
    !confirmed &&
    existing &&
    NodeUtil.isDeepStrictEqual(existing, body) &&
    sameLatest
  ) {
    return NodeUtil.isDeepStrictEqual(current?.slackThread, thread)
      ? current!
      : { ...current!, slackThread: thread!, revision: current!.revision + 1 };
  }
  const items = [...(current?.items ?? []).filter((candidate) => candidate.id !== item.id), body]
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id))
    .slice(-50);
  // An older delivery can be absent because it was evicted, not because it is new.
  if (
    !latestReply &&
    !confirmed &&
    current &&
    sameLatest &&
    NodeUtil.isDeepStrictEqual(current.items, items)
  )
    return NodeUtil.isDeepStrictEqual(current.slackThread, thread)
      ? current
      : { ...current, slackThread: thread!, revision: current.revision + 1 };
  if (!latestReply && existing?.source === "linear" && body.linearIssue) {
    const { linearIssue: _oldIssue, ...oldContent } = existing;
    const { linearIssue: _newIssue, ...newContent } = body;
    if (NodeUtil.isDeepStrictEqual(oldContent, newContent))
      return { ...current!, items, revision: current!.revision + 1 };
  }
  const formattingOnly =
    existing?.source === "slack" &&
    existing.sourceContentHash &&
    existing.sourceContentHash === item.sourceContentHash &&
    sameLatest;
  return {
    id: inboxIdentity(projectId, item),
    projectId,
    source: item.source,
    connectionId: item.connectionId,
    groupId: item.groupId,
    ...(thread ? { slackThread: thread } : {}),
    ...(replyCursor ? { replyCursor } : {}),
    revision: (current?.revision ?? -1) + 1,
    state:
      replyActivity !== undefined
        ? {
            ...(current?.state ?? {
              read: false,
              placement: "active",
              snoozedUntil: null,
              threadId: null,
            }),
            ...(latestReply ? { read: latestReply.isSelf } : {}),
            ...(latestIncoming && current?.state.placement === "resolved"
              ? { placement: "active", snoozedUntil: null }
              : {}),
          }
        : current
          ? formattingOnly
            ? current.state
            : { ...current.state, read: false }
          : { read: false, placement: "active", snoozedUntil: null, threadId: null },
    items,
    analysis: null,
    analysisAttempts: 0,
    analysisRetryAt: null,
    processingError: null,
    analysisVersion: (current?.analysisVersion ?? -1) + 1,
    agentStatus: current?.agentStatus ?? "idle",
    agentError: current?.agentError ?? null,
    agentAttempt: current?.agentAttempt ?? 0,
    agentIntent: current?.agentIntent ?? null,
    linkedChatSettled: current?.linkedChatSettled ?? false,
    updatedAt:
      replyActivity !== undefined
        ? (latestIncoming?.occurredAt ?? current?.updatedAt ?? items.at(-1)!.occurredAt)
        : items.at(-1)!.occurredAt,
    confirmedOutcome: current?.confirmedOutcome ?? null,
    ...(current?.replyAttempt ? { replyAttempt: current.replyAttempt } : {}),
  };
}
export function restoreInboxState(
  current: InboxNotification,
  before: InboxState,
): InboxNotification {
  const undoDelegation = before.threadId === null && current.state.threadId !== null;
  return {
    ...current,
    state: { ...before, threadId: current.state.threadId },
    agentIntent:
      undoDelegation && ["starting", "running"].includes(current.agentStatus)
        ? "stop"
        : current.agentIntent,
    agentStatus:
      undoDelegation && ["starting", "running"].includes(current.agentStatus)
        ? "stop-requested"
        : current.agentStatus,
  };
}
