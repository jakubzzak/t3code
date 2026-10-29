import { create } from "zustand";
import {
  CommandId,
  type EnvironmentId,
  type InboxNotification,
  type InboxReplyInput,
  type InboxReplyAttempt,
} from "@t3tools/contracts";
import { randomUUID } from "~/lib/utils";

export function inboxReplyTarget(n: InboxNotification) {
  return (
    n.items.at(-1)?.replyTarget ??
    (n.source === "slack" && n.slackThread
      ? { source: "slack" as const, channelId: n.slackThread.channelId, threadTs: n.slackThread.ts }
      : null)
  );
}
export const inboxReplyKey = (environmentId: EnvironmentId, id: string) => `${environmentId}:${id}`;
type ReplyDraft = {
  input: InboxReplyInput;
  open: boolean;
  pending: boolean;
  result?: InboxReplyAttempt | undefined;
  error?: string | undefined;
};
export const useInboxReplyDrafts = create<{ drafts: Record<string, ReplyDraft> }>(() => ({
  drafts: {},
}));
export function updateInboxReply(key: string, update: (draft: ReplyDraft) => ReplyDraft) {
  useInboxReplyDrafts.setState(({ drafts }) =>
    drafts[key] ? { drafts: { ...drafts, [key]: update(drafts[key]) } } : { drafts },
  );
}
/** Capture destination and text once; incoming suggestions never replace a user's draft. */
export function openInboxReply(environmentId: EnvironmentId, n: InboxNotification) {
  const key = inboxReplyKey(environmentId, n.id);
  const target = inboxReplyTarget(n);
  const item = n.items.at(-1);
  if (!target || !item) return;
  useInboxReplyDrafts.setState(({ drafts }) => ({
    drafts: {
      ...drafts,
      [key]:
        drafts[key] && drafts[key].result?.status !== "sent"
          ? { ...drafts[key], open: true }
          : {
              open: true,
              pending: false,
              input: {
                projectId: n.projectId,
                id: n.id,
                itemId: item.id,
                target,
                commandId: CommandId.make(randomUUID()),
                text: n.analysis?.replyDraft ?? "",
              },
            },
    },
  }));
}
