import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import type { InboxSourceItem } from "@t3tools/contracts";

const Message = Schema.Struct({
  ts: Schema.String,
  text: Schema.optionalKey(Schema.String),
  user: Schema.optionalKey(Schema.NullOr(Schema.String)),
  username: Schema.optionalKey(Schema.NullOr(Schema.String)),
  thread_ts: Schema.optionalKey(Schema.String),
});
const History = Schema.Struct({
  ok: Schema.Boolean,
  messages: Schema.optionalKey(Schema.Array(Message)),
  has_more: Schema.optionalKey(Schema.Boolean),
  response_metadata: Schema.optionalKey(
    Schema.Struct({ next_cursor: Schema.optionalKey(Schema.String) }),
  ),
});
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
    Schema.Struct({ id: Schema.String, users: Schema.optionalKey(Schema.Array(Schema.String)) }),
  ),
});
const decodeIdentity = Schema.decodeUnknownSync(Identity);
const decodeHistory = Schema.decodeUnknownSync(History);
const decodeConversations = Schema.decodeUnknownSync(Conversations);
const decodeSearch = Schema.decodeUnknownSync(Search);
const decodeGroups = Schema.decodeUnknownSync(Groups);
export type SlackRead = (method: string, params: Record<string, string>) => Promise<unknown>;
export const SLACK_READ_METHODS = new Set([
  "auth.test",
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
  const identity = decodeIdentity(await read("auth.test", {}));
  const items = new Map<string, InboxSourceItem>();
  const append = (
    channel: string,
    location: string,
    message: typeof Message.Type,
    context: string,
    url?: string,
  ) => {
    if (message.user === identity.user_id) return;
    const id = `${channel}:${message.ts}`;
    items.set(id, {
      id,
      source: "slack",
      connectionId: `${identity.team_id}:${identity.user_id}`,
      groupId: `${channel}:${message.thread_ts ?? message.ts}`,
      location,
      title: (message.text ?? "Slack notification").split("\n")[0]!.slice(0, 250),
      author: message.user || message.username || "Slack",
      content: `${message.text ?? ""}${context ? `\n\nThread context:\n${context}` : ""}`.slice(
        0,
        32000,
      ),
      url:
        url ??
        `https://app.slack.com/client/${identity.team_id}/${channel}/thread/${channel}-${message.thread_ts ?? message.ts}`,
      occurredAt: DateTime.formatIso(DateTime.makeUnsafe(Number(message.ts) * 1000)),
    });
  };
  const contextFor = async (channel: string, message: typeof Message.Type) => {
    if (!message.thread_ts) return "";
    const response = decodeHistory(
      await read("conversations.replies", { channel, ts: message.thread_ts, limit: "15" }),
    );
    const context = (response.messages ?? [])
      .filter((entry) => entry.ts !== message.ts)
      .map((entry) => `${entry.user || entry.username || "Slack"}: ${entry.text ?? ""}`)
      .join("\n");
    return `${context}${response.has_more || response.response_metadata?.next_cursor ? "\n[Additional thread messages omitted; open the original for the complete thread.]" : ""}`;
  };
  if (categories.includes("dms")) {
    let cursor = "";
    const cursors = new Set<string>();
    do {
      const page = decodeConversations(
        await read("conversations.list", { types: "im,mpim", limit: "200", cursor }),
      );
      for (const channel of page.channels ?? []) {
        let historyCursor = "";
        const historyCursors = new Set<string>();
        do {
          const history = decodeHistory(
            await read("conversations.history", {
              channel: channel.id,
              oldest: String(Date.parse(since) / 1000),
              limit: "100",
              cursor: historyCursor,
            }),
          );
          for (const message of history.messages ?? [])
            append(
              channel.id,
              channel.name ?? `DM · ${channel.user ?? channel.id}`,
              message,
              await contextFor(channel.id, message),
            );
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
  if (categories.includes("mentions")) queries.push(`<@${identity.user_id}>`);
  if (categories.includes("group-mentions")) {
    const groups = decodeGroups(await read("usergroups.list", { include_users: "true" }));
    for (const group of groups.usergroups)
      if (group.users?.includes(identity.user_id)) queries.push(`<!subteam^${group.id}>`);
  }
  for (const query of queries) {
    let pages = 1;
    for (let page = 1; page <= pages; page++) {
      const result = decodeSearch(
        await read("search.messages", {
          query: `${query} after:${since.slice(0, 10)}`,
          count: "100",
          page: String(page),
          sort: "timestamp",
          sort_dir: "asc",
        }),
      );
      pages = result.messages?.paging.pages ?? 1;
      if (pages > 100)
        throw new Error(
          "Slack search exceeds the supported batch size. Choose a shorter initial history window.",
        );
      for (const hit of result.messages?.matches ?? []) {
        let message = hit;
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
          if (native?.thread_ts) message = { ...hit, thread_ts: native.thread_ts };
        }
        append(
          message.channel.id,
          `#${message.channel.name}`,
          message,
          await contextFor(message.channel.id, message),
          message.permalink,
        );
      }
    }
  }
  return [...items.values()];
}
