import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { Message, History, messageText } from "./slackMessages.ts";
import { readSlackThread } from "./slackThread.ts";
import { readableSlackItem } from "../notificationContent.ts";
import type { InboxSourceItem } from "@t3tools/contracts";
import type { SlackNames } from "@t3tools/shared/slackText";

const Conversations = Schema.Struct({
  ok: Schema.Boolean,
  channels: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.optionalKey(Schema.String),
        user: Schema.optionalKey(Schema.String),
        is_im: Schema.optionalKey(Schema.Boolean),
        is_mpim: Schema.optionalKey(Schema.Boolean),
      }),
    ),
  ),
  response_metadata: Schema.optionalKey(
    Schema.Struct({ next_cursor: Schema.optionalKey(Schema.String) }),
  ),
});
const Search = Schema.Struct({
  ok: Schema.Boolean,
  messages: Schema.optionalKey(
    Schema.Struct({
      matches: Schema.Array(
        Schema.Struct({
          ...Message.fields,
          permalink: Schema.String,
          channel: Schema.Struct({ id: Schema.String, name: Schema.String }),
        }),
      ),
      paging: Schema.Struct({ pages: Schema.Number }),
    }),
  ),
});
const Identity = Schema.Struct({
  ok: Schema.Boolean,
  user_id: Schema.String,
  team_id: Schema.String,
});
const Groups = Schema.Struct({
  ok: Schema.Boolean,
  usergroups: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      handle: Schema.optionalKey(Schema.String),
      name: Schema.optionalKey(Schema.String),
      users: Schema.optionalKey(Schema.Array(Schema.String)),
    }),
  ),
});
const User = Schema.Struct({
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
const decodeUser = Schema.decodeUnknownSync(User);
const decodeIdentity = Schema.decodeUnknownSync(Identity);
const decodeHistory = Schema.decodeUnknownSync(History);
const decodeConversations = Schema.decodeUnknownSync(Conversations);
const decodeSearch = Schema.decodeUnknownSync(Search);
const decodeGroups = Schema.decodeUnknownSync(Groups);
export type SlackRead = (method: string, params: Record<string, string>) => Promise<unknown>;
export const SLACK_READ_METHODS = new Set([
  "auth.test",
  "users.info",
  "conversations.list",
  "conversations.history",
  "conversations.replies",
  "search.messages",
  "usergroups.list",
]);

/** Only documented read methods. Current Saved/To-dos are deliberately absent. */
export async function readSlackInbox(
  read: SlackRead,
  categories: ReadonlyArray<string>,
  since: string,
): Promise<ReadonlyArray<InboxSourceItem>> {
  const sinceMillis = Date.parse(since);
  const identity = decodeIdentity(await read("auth.test", {}));
  const items = new Map<string, InboxSourceItem>();
  let groups: Promise<typeof Groups.Type> | undefined;
  const getGroups = () =>
    (groups ??= read("usergroups.list", { include_users: "true" })
      .then(decodeGroups)
      .then((result) => {
        for (const group of result.usergroups)
          names.groups[group.id] = group.handle || group.name || group.id;
        names.memberGroupIds = result.usergroups
          .filter((group) => group.users?.includes(identity.user_id))
          .map((group) => group.id);
        return result;
      }));
  const names: SlackNames & { users: Record<string, string>; groups: Record<string, string> } = {
    viewerUserId: identity.user_id,
    users: {},
    groups: {},
  };
  const profiles = new Map<string, Promise<string>>();
  let profilesAvailable = true;
  const displayName = (id: string): Promise<string> => {
    if (names.users[id]) return Promise.resolve(names.users[id]!);
    if (!/^[UW][A-Z0-9]+$/.test(id) || !profilesAvailable) return Promise.resolve(id);
    let profile = profiles.get(id);
    if (!profile) {
      profile = read("users.info", { user: id })
        .then((result) => {
          const user = decodeUser(result).user;
          return (names.users[id] =
            user.profile?.display_name?.trim() ||
            user.profile?.real_name?.trim() ||
            user.real_name?.trim() ||
            user.name?.trim() ||
            id);
        })
        .catch((error: unknown) => {
          if (error instanceof Error && /\bmissing_scope\b/.test(error.message)) {
            profilesAvailable = false;
            return id;
          }
          if (
            error instanceof Error &&
            /\b(?:user_not_found|account_inactive)\b/.test(error.message)
          )
            return id;
          throw error;
        });
      profiles.set(id, profile);
    }
    return profile;
  };
  const append = async (
    channel: string,
    location: string,
    message: typeof Message.Type,
    thread: Awaited<ReturnType<typeof readSlackThread>> | undefined,
    url?: string,
  ) => {
    if (message.user === identity.user_id) return;
    const id = `${channel}:${message.ts}`;
    const context = (thread ? [thread.root, ...thread.messages] : [])
      .filter((entry) => entry.ts !== message.ts)
      .map((entry) => `${entry.author}: ${entry.content}`)
      .join("\n");
    const raw =
      `${messageText(message)}${context ? `\n\nThread context:\n${context}${thread?.nextCursor ? "\n[Additional thread messages omitted; open the original for the complete thread.]" : ""}` : ""}`.slice(
        0,
        32000,
      );
    const people = new Set(
      [...raw.matchAll(/<@([UW][A-Z0-9]+)(?:\|[^>]+)?>|(?:^|\n)([UW][A-Z0-9]+):/g)].map(
        (match) => match[1] || match[2]!,
      ),
    );
    if (message.user) people.add(message.user);
    for (const person of people) await displayName(person);
    if (raw.includes("<!subteam^") && names.memberGroupIds === undefined)
      for (const group of (await getGroups()).usergroups)
        names.groups[group.id] = group.handle || group.name || group.id;
    const formatted = readableSlackItem(
      {
        id,
        source: "slack",
        connectionId: `${identity.team_id}:${identity.user_id}`,
        groupId: `${channel}:${message.thread_ts ?? message.ts}`,
        replyTarget: {
          source: "slack",
          channelId: channel,
          threadTs: message.thread_ts ?? message.ts,
        },
        location,
        title: (message.text ?? "Slack notification").split("\n")[0]!.slice(0, 250),
        author:
          (message.user && names.users[message.user]) ||
          message.username ||
          message.bot_profile?.name ||
          message.user ||
          "Slack",
        content: raw,
        ...(thread ? { slackThread: thread } : {}),
        url:
          url ??
          `https://app.slack.com/client/${identity.team_id}/${channel}/thread/${channel}-${message.thread_ts ?? message.ts}`,
        occurredAt: DateTime.formatIso(DateTime.makeUnsafe(Number(message.ts) * 1000)),
      },
      names,
    );
    items.set(id, {
      ...formatted,
      slackThread: thread ?? {
        formatVersion: 2,
        channelId: channel,
        ts: message.ts,
        root: {
          ts: message.ts,
          author: formatted.author,
          content: formatted.content,
          formattedContent: formatted.formattedContent!,
          formattedTitle: formatted.formattedTitle!,
          slackMentions: formatted.slackMentions!,
          occurredAt: formatted.occurredAt,
        },
        latestReplyTs: null,
        replyCount: 0,
        messages: [],
        nextCursor: null,
      },
    });
  };
  const threads = new Map<string, Promise<Awaited<ReturnType<typeof readSlackThread>>>>();
  const dmLocations = new Map<string, string>();
  const contextFor = (channel: string, message: typeof Message.Type) => {
    const ts = message.thread_ts ?? (message.reply_count ? message.ts : undefined);
    if (!ts) return Promise.resolve(undefined);
    const key = `${channel}:${ts}`;
    let thread = threads.get(key);
    if (!thread) {
      thread = readSlackThread(read, channel, ts, undefined, names);
      threads.set(key, thread);
    }
    return thread;
  };
  if (categories.includes("dms")) {
    let cursor = "";
    const cursors = new Set<string>();
    do {
      const page = decodeConversations(
        await read("conversations.list", { types: "im,mpim", limit: "200", cursor }),
      );
      for (const channel of page.channels ?? []) {
        const location =
          channel.name ?? `DM · ${channel.user ? await displayName(channel.user) : channel.id}`;
        dmLocations.set(channel.id, location);
        let historyCursor = "";
        const historyCursors = new Set<string>();
        do {
          const history = decodeHistory(
            await read("conversations.history", {
              channel: channel.id,
              oldest: String(sinceMillis / 1000),
              inclusive: "true",
              limit: "100",
              cursor: historyCursor,
            }),
          );
          for (const message of history.messages ?? []) {
            if (Number(message.ts) * 1000 < sinceMillis || message.user === identity.user_id)
              continue;
            await append(channel.id, location, message, await contextFor(channel.id, message));
          }
          historyCursor = history.response_metadata?.next_cursor ?? "";
          if (
            (historyCursor && historyCursors.has(historyCursor)) ||
            (history.has_more && !historyCursor)
          )
            throw new Error(
              "Slack returned incomplete conversation history. Try a shorter initial history window.",
            );
          if (historyCursor) historyCursors.add(historyCursor);
        } while (historyCursor);
      }
      cursor = page.response_metadata?.next_cursor ?? "";
      if (cursor && cursors.has(cursor))
        throw new Error("Slack returned a repeated conversation cursor.");
      if (cursor) cursors.add(cursor);
    } while (cursor);
  }
  const queries: string[] = [];
  // A reply does not move its parent into conversations.history's oldest window.
  if (categories.includes("dms")) queries.push("is:dm is:thread");
  if (categories.includes("mentions")) queries.push(`<@${identity.user_id}>`);
  if (categories.includes("group-mentions")) {
    if (names.memberGroupIds === undefined) await getGroups();
    for (const id of names.memberGroupIds ?? []) queries.push(`<!subteam^${id}>`);
  }
  for (const query of queries) {
    let pages = 1;
    for (let page = 1; page <= pages; page++) {
      const result = decodeSearch(
        await read("search.messages", {
          // Search only supports calendar dates. Include the boundary day, then stop the
          // descending pages at the precise checkpoint before fetching any older bodies.
          query: `${query} after:${DateTime.formatIso(DateTime.makeUnsafe(sinceMillis - 86_400_000)).slice(0, 10)}`,
          count: "100",
          page: String(page),
          sort: "timestamp",
          sort_dir: "desc",
        }),
      );
      pages = result.messages?.paging.pages ?? 1;
      let reachedCheckpoint = false;
      for (const hit of result.messages?.matches ?? []) {
        if (Number(hit.ts) * 1000 < sinceMillis) {
          reachedCheckpoint = true;
          continue;
        }
        if (hit.user === identity.user_id || items.has(`${hit.channel.id}:${hit.ts}`)) continue;
        if (query === "is:dm is:thread" && !dmLocations.has(hit.channel.id)) continue;
        let message = hit;
        // Search links can retain the parent ID even when the match omits thread_ts.
        if (!message.thread_ts) {
          const parent = new URL(hit.permalink).searchParams.get("thread_ts");
          if (parent && /^\d+(?:\.\d+)?$/.test(parent)) message = { ...hit, thread_ts: parent };
        }
        if (!message.thread_ts) {
          const exact = decodeHistory(
            await read("conversations.history", {
              channel: hit.channel.id,
              latest: hit.ts,
              oldest: hit.ts,
              inclusive: "true",
              limit: "1",
            }),
          );
          const native = exact.messages?.find((entry) => entry.ts === hit.ts);
          if (native) message = { ...hit, ...native };
        } else if (message.thread_ts !== message.ts) {
          const exact = decodeHistory(
            await read("conversations.replies", {
              channel: hit.channel.id,
              ts: message.thread_ts,
              oldest: hit.ts,
              latest: hit.ts,
              inclusive: "true",
              limit: "1",
            }),
          );
          const native = exact.messages?.find((entry) => entry.ts === hit.ts);
          if (!native)
            throw new Error("Slack did not return the matching thread reply. Try syncing again.");
          message = { ...message, ...native, thread_ts: message.thread_ts };
        }
        await append(
          message.channel.id,
          dmLocations.get(message.channel.id) ?? `#${message.channel.name}`,
          message,
          await contextFor(message.channel.id, message),
          message.permalink,
        );
      }
      if (reachedCheckpoint) break;
      if (page === 100 && pages > page)
        throw new Error(
          "Slack search exceeds the supported batch size. Choose a shorter initial history window.",
        );
    }
  }
  return [...items.values()];
}
