// @effect-diagnostics nodeBuiltinImport:off -- Pure stable source identity shared by ingestion and persistence.
import * as NodeCrypto from "node:crypto";
import * as NodeUtil from "node:util";
import type {
  InboxNotification,
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
export function mergeSlackThread(
  previous: InboxSlackThread | undefined,
  incoming: InboxSlackThread,
) {
  if (!previous || previous.ts !== incoming.ts || previous.channelId !== incoming.channelId)
    return incoming;
  if (incoming.formatVersion === 2 && previous.formatVersion !== 2) return incoming;
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
export function ingestInboxItem(
  projectId: ProjectId,
  item: InboxSourceItem,
  previous?: InboxNotification,
): InboxNotification {
  const existing = previous?.items.find((candidate) => candidate.id === item.id);
  const incomingThread = item.slackThread;
  const { slackThread: _incomingThread, ...body } = item;
  const thread = incomingThread
    ? mergeSlackThread(previous?.slackThread, incomingThread)
    : previous?.slackThread;
  const sameLatest =
    (previous?.slackThread?.latestReplyTs ?? null) === (thread?.latestReplyTs ?? null);
  if (existing && NodeUtil.isDeepStrictEqual(existing, body) && sameLatest) {
    return NodeUtil.isDeepStrictEqual(previous?.slackThread, thread)
      ? previous!
      : { ...previous!, slackThread: thread!, revision: previous!.revision + 1 };
  }
  const items = [...(previous?.items ?? []).filter((candidate) => candidate.id !== item.id), body]
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .slice(-50);
  if (existing?.source === "linear" && body.linearIssue) {
    const { linearIssue: _oldIssue, ...oldContent } = existing;
    const { linearIssue: _newIssue, ...newContent } = body;
    if (NodeUtil.isDeepStrictEqual(oldContent, newContent))
      return { ...previous!, items, revision: previous!.revision + 1 };
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
    revision: (previous?.revision ?? -1) + 1,
    state: previous
      ? formattingOnly
        ? previous.state
        : { ...previous.state, read: false }
      : { read: false, placement: "active", snoozedUntil: null, threadId: null },
    items,
    analysis: null,
    analysisAttempts: 0,
    analysisRetryAt: null,
    processingError: null,
    analysisVersion: (previous?.analysisVersion ?? -1) + 1,
    agentStatus: previous?.agentStatus ?? "idle",
    agentError: previous?.agentError ?? null,
    agentAttempt: previous?.agentAttempt ?? 0,
    agentIntent: previous?.agentIntent ?? null,
    linkedChatSettled: previous?.linkedChatSettled ?? false,
    updatedAt: items.at(-1)!.occurredAt,
    confirmedOutcome: previous?.confirmedOutcome ?? null,
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
