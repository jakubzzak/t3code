import type { InboxNotification } from "@t3tools/contracts";
import type { InboxAttachments } from "./InboxAttachments.ts";
import type * as Effect from "effect/Effect";
import { readableInboxItem } from "./notificationContent.ts";
/** Bound provider context independently of stored detail; keep the latest triggering activity. */
export function inboxContext(
  notification: InboxNotification,
  images?: Effect.Success<ReturnType<InboxAttachments["Service"]["load"]>>["context"],
) {
  return JSON.stringify({
    ...(images?.length ? { imageAttachments: images } : {}),
    notificationId: notification.id,
    source: notification.source,
    omittedEarlierItems: Math.max(0, notification.items.length - 10),
    items: notification.items
      .slice(-10)
      .map(readableInboxItem)
      .map(
        ({
          formattedContent: _formattedContent,
          formattedTitle: _formattedTitle,
          slackMentions: _mentions,
          slackThread: _thread,
          linearIssue: _issue,
          ...item
        }) => ({
          ...item,
          content: item.content.slice(0, 4000),
          truncated: item.content.length > 4000,
        }),
      ),
    ...(notification.slackThread
      ? {
          slackThread: {
            root: {
              author: notification.slackThread.root.author,
              content: notification.slackThread.root.content.slice(0, 4000),
              images: notification.slackThread.root.images?.map(({ id, name }) => ({ id, name })),
            },
            latestReplyTs: notification.slackThread.latestReplyTs,
            replyCount: notification.slackThread.replyCount,
            omittedEarlierMessages: Math.max(
              0,
              (notification.slackThread.replyCount ?? notification.slackThread.messages.length) -
                Math.min(10, notification.slackThread.messages.length),
            ),
            messages: notification.slackThread.messages.slice(-10).map((message) => ({
              author: message.author,
              occurredAt: message.occurredAt,
              content: message.content.slice(0, 4000),
              images: message.images?.map(({ id, name }) => ({ id, name })),
            })),
          },
        }
      : {}),
    ...(notification.linearIssue
      ? {
          linearIssue: {
            title: notification.linearIssue.title,
            description: notification.linearIssue.description?.slice(0, 4000),
            omittedEarlierComments: Math.max(0, notification.linearIssue.comments.length - 10),
            comments: notification.linearIssue.comments.slice(-10).map((comment) => ({
              author: comment.author,
              occurredAt: comment.occurredAt,
              body: comment.body.slice(0, 4000),
            })),
          },
        }
      : {}),
    analysis: notification.analysis,
  });
}
