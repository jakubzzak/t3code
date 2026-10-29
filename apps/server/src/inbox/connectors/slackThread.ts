import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import { slackText, slackMentions, type SlackNames } from "@t3tools/shared/slackText";
import { slackEmojis } from "../slackEmoji.ts";
import type { InboxSlackMessage, InboxSlackThread } from "@t3tools/contracts";
import { History, Message, messageText } from "./slackMessages.ts";
import type { SlackRead } from "./slack.ts";

const decode = Schema.decodeUnknownSync(History);
const Profile = Schema.Struct({
  user: Schema.Struct({
    name: Schema.optionalKey(Schema.NullOr(Schema.String)),
    real_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
    profile: Schema.optionalKey(
      Schema.NullOr(
        Schema.Struct({
          display_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
          real_name: Schema.optionalKey(Schema.NullOr(Schema.String)),
        }),
      ),
    ),
  }),
});
const decodeProfile = Schema.decodeUnknownSync(Profile);

const decodeGroups = Schema.decodeUnknownSync(
  Schema.Struct({
    usergroups: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        handle: Schema.optionalKey(Schema.String),
        name: Schema.optionalKey(Schema.String),
        users: Schema.optionalKey(Schema.Array(Schema.String)),
      }),
    ),
  }),
);
const decodeIdentity = Schema.decodeUnknownSync(Schema.Struct({ user_id: Schema.String }));

/** One cached page plus the authoritative latest reply, never the last of an incomplete page. */
export async function readSlackThread(
  read: SlackRead,
  channelId: string,
  ts: string,
  cached?: InboxSlackThread,
  names: SlackNames = { users: {}, groups: {} },
): Promise<InboxSlackThread> {
  // Legacy caches flattened references into names, so recover native IDs once from Slack.
  if (cached?.formatVersion !== 2) cached = undefined;
  if (cached && !cached.nextCursor) return cached;
  const response = decode(
    await read("conversations.replies", {
      channel: channelId,
      ts,
      limit: "15",
      ...(cached?.nextCursor ? { cursor: cached.nextCursor } : {}),
      ...(cached?.latestReplyTs ? { latest: cached.latestReplyTs, inclusive: "true" } : {}),
    }),
  );
  const raw = [...(response.messages ?? [])];
  const root = raw.find((message) => message.ts === ts);
  if (!root && !cached) throw new Error("Slack did not return the thread's original message.");
  const nextCursor = response.response_metadata?.next_cursor || null;
  if (response.has_more && !nextCursor)
    throw new Error("Slack returned an incomplete thread page without a cursor.");
  if (nextCursor && nextCursor === cached?.nextCursor)
    throw new Error("Slack returned a repeated thread cursor.");
  const latestReplyTs =
    root?.reply_count === 0
      ? null
      : (cached?.latestReplyTs ??
        root?.latest_reply ??
        (!nextCursor ? (raw.findLast((message) => message.ts !== ts)?.ts ?? null) : null));
  if (nextCursor && !latestReplyTs)
    throw new Error("Slack did not provide the latest reply timestamp. Open the original thread.");
  if (
    latestReplyTs &&
    !raw.some((message) => message.ts === latestReplyTs) &&
    !cached?.messages.some((message) => message.ts === latestReplyTs)
  ) {
    const latest = decode(
      await read("conversations.replies", {
        channel: channelId,
        ts,
        oldest: latestReplyTs,
        latest: latestReplyTs,
        inclusive: "true",
        limit: "1",
      }),
    );
    const message = latest.messages?.find((message) => message.ts === latestReplyTs);
    if (!message) throw new Error("Slack's latest reply could not be loaded. Try syncing again.");
    raw.push(message);
  }
  const users: Record<string, string> = { ...names.users };
  const groups: Record<string, string> = { ...names.groups };
  const people = new Set<string>();
  for (const message of raw) {
    if (message.user) people.add(message.user);
    for (const match of messageText(message).matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g))
      people.add(match[1]!);
  }
  for (const userId of people) {
    if (users[userId] || !/^[UW][A-Z0-9]+$/.test(userId)) continue;
    try {
      const user = decodeProfile(await read("users.info", { user: userId })).user;
      users[userId] =
        user.profile?.display_name?.trim() ||
        user.profile?.real_name?.trim() ||
        user.real_name?.trim() ||
        user.name?.trim() ||
        userId;
    } catch (cause) {
      if (
        !(cause instanceof Error) ||
        !/\b(?:missing_scope|user_not_found|account_inactive)\b/.test(cause.message)
      )
        throw cause;
      users[userId] = userId;
    }
  }
  const groupIds = raw.flatMap((message) =>
    [...messageText(message).matchAll(/<!subteam\^([A-Z0-9]+)/g)].map((match) => match[1]!),
  );
  if (!names.viewerUserId && raw.some((message) => slackMentions(messageText(message)).length > 0))
    names.viewerUserId = decodeIdentity(await read("auth.test", {})).user_id;
  if (
    groupIds.length &&
    (names.memberGroupIds === undefined || groupIds.some((id) => !groups[id]))
  ) {
    const result = decodeGroups(await read("usergroups.list", { include_users: "true" }));
    for (const group of result.usergroups)
      groups[group.id] = group.handle || group.name || group.id;
    names.memberGroupIds = result.usergroups
      .filter((group) => names.viewerUserId && group.users?.includes(names.viewerUserId))
      .map((group) => group.id);
  }
  Object.assign(names.users ?? {}, users);
  Object.assign(names.groups ?? {}, groups);
  const options = { ...names, users, groups, emojis: slackEmojis };
  const format = (message: typeof Message.Type): InboxSlackMessage => ({
    ts: message.ts,
    ...(message.user ? { authorId: message.user } : {}),
    author:
      (message.user && users[message.user]) ||
      message.username ||
      message.bot_profile?.name ||
      message.user ||
      "Slack",
    content: slackText(messageText(message), options, "text").slice(0, 32000),
    formattedContent: slackText(messageText(message), options, "rich").slice(0, 32000),
    formattedTitle: slackText(
      messageText(message).split("\n")[0]!.slice(0, 250),
      options,
      "rich",
    ).slice(0, 2000),
    slackMentions: slackMentions(messageText(message), options),
    occurredAt: DateTime.formatIso(DateTime.makeUnsafe(Number(message.ts) * 1000)),
  });
  const messages = new Map(cached?.messages.map((message) => [message.ts, message]));
  for (const message of raw) if (message.ts !== ts) messages.set(message.ts, format(message));
  return {
    formatVersion: 2,
    channelId,
    ts,
    root: cached?.root ?? format(root!),
    latestReplyTs,
    replyCount: cached?.replyCount ?? root?.reply_count ?? (!nextCursor ? messages.size : null),
    messages: [...messages.values()].sort((a, b) => Number(a.ts) - Number(b.ts)),
    nextCursor,
  };
}
