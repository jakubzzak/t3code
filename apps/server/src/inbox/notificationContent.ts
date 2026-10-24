// @effect-diagnostics nodeBuiltinImport:off -- Hash source text to distinguish formatting repairs from new activity.
import * as NodeCrypto from "node:crypto";
import { slackText, slackMentions, type SlackNames } from "@t3tools/shared/slackText";
import { slackEmojis } from "./slackEmoji.ts";
import type { InboxNotification, InboxSourceItem } from "@t3tools/contracts";
import { emailText } from "@t3tools/shared/emailText";

export function readableSlackItem(item: InboxSourceItem, names: SlackNames = {}): InboxSourceItem {
  const options = { ...names, emojis: slackEmojis };
  return {
    ...item,
    content: slackText(item.content, options, "text").slice(0, 32000),
    formattedContent: slackText(item.content, options, "rich").slice(0, 32000),
    formattedTitle: slackText(item.content.split("\n")[0]!.slice(0, 250), options, "rich").slice(
      0,
      2000,
    ),
    slackMentions: slackMentions(item.content, options),
    title: slackText(item.content, options, "preview").replace(/\s+/g, " ").slice(0, 250),
    contentFormat: "text",
    sourceContentHash: NodeCrypto.createHash("sha256").update(item.content).digest("hex"),
  };
}

/** Mark converted content so literal HTML examples in plain text are never parsed again. */
export function readableInboxItem(item: InboxSourceItem): InboxSourceItem {
  if (item.source === "slack" && !item.contentFormat) return readableSlackItem(item);
  if (item.source !== "superhuman" || item.contentFormat === "text") return item;
  return { ...item, content: emailText(item.content), contentFormat: "text" };
}

/** Repair cached email presentation without changing read, triage or chat state. */
export function readableNotification(notification: InboxNotification): InboxNotification {
  const items = notification.items.map(readableInboxItem);
  if (items.every((item, index) => item === notification.items[index])) return notification;
  const changed = items.some((item, index) => item.content !== notification.items[index]?.content);
  const { suggestionResearch: _research, ...withoutResearch } = notification;
  return {
    ...(changed ? withoutResearch : notification),
    items,
    ...(changed
      ? {
          analysis: null,
          processingError: null,
          analysisAttempts: 0,
          analysisRetryAt: null,
          analysisVersion: notification.analysisVersion + 1,
        }
      : {}),
  };
}
