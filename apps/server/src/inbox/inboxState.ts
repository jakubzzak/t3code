// @effect-diagnostics nodeBuiltinImport:off -- Pure stable source identity shared by ingestion and persistence.
import * as NodeCrypto from "node:crypto";
import * as NodeUtil from "node:util";
import type { InboxNotification, InboxSourceItem, InboxState, ProjectId } from "@t3tools/contracts";

/** Native group identity is scoped to a connection and project, never inferred across sources. */
export function inboxIdentity(projectId: ProjectId, item: InboxSourceItem) {
  return NodeCrypto.createHash("sha256")
    .update(JSON.stringify([projectId, item.source, item.connectionId, item.groupId]))
    .digest("hex");
}
export function ingestInboxItem(
  projectId: ProjectId,
  item: InboxSourceItem,
  previous?: InboxNotification,
): InboxNotification {
  const existing = previous?.items.find((candidate) => candidate.id === item.id);
  if (existing && NodeUtil.isDeepStrictEqual(existing, item)) return previous!;
  const items = [...(previous?.items ?? []).filter((candidate) => candidate.id !== item.id), item]
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt))
    .slice(-50);
  const formattingOnly =
    existing?.source === "slack" &&
    existing.sourceContentHash &&
    existing.sourceContentHash === item.sourceContentHash;
  return {
    id: inboxIdentity(projectId, item),
    projectId,
    source: item.source,
    connectionId: item.connectionId,
    groupId: item.groupId,
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
