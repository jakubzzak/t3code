import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";
import { readableSlackItem } from "../notificationContent.ts";
import type { InboxSourceItem } from "@t3tools/contracts";

const Message = Schema.Struct({
  ts: Schema.String,
  text: Schema.optionalKey(Schema.NullOr(Schema.String)),
  user: Schema.optionalKey(Schema.NullOr(Schema.String)),
  username: Schema.optionalKey(Schema.NullOr(Schema.String)),
  bot_profile: Schema.optionalKey(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
  thread_ts: Schema.optionalKey(Schema.String),
  blocks: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  attachments: Schema.optionalKey(Schema.Array(Schema.Unknown)),
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

/** Text-bearing Block Kit fields only; never fetch files, images, unfurls or remote HTML. */
function blockText(value: unknown, depth = 0): string {
  if (depth > 8 || value === null || typeof value !== "object")
    return typeof value === "string" ? value : "";
  if (Array.isArray(value))
    return value
      .map((entry) => blockText(entry, depth + 1))
      .filter(Boolean)
      .join("\n");
  const node = value as Record<string, unknown>;
  if (node.type === "user" && typeof node.user_id === "string") return `<@${node.user_id}>`;
  if (node.type === "usergroup" && typeof node.usergroup_id === "string")
    return `<!subteam^${node.usergroup_id}>`;
  if (node.type === "channel" && typeof node.channel_id === "string")
    return `<#${node.channel_id}>`;
  if (node.type === "emoji" && typeof node.name === "string") return `:${node.name}:`;
  if (node.type === "link" && typeof node.url === "string")
    return `<${node.url}|${typeof node.text === "string" ? node.text : node.url}>`;
  if (Array.isArray(node.elements)) {
    const body = node.elements
      .map((entry) => blockText(entry, depth + 1))
      .filter(Boolean)
      .join(node.type === "rich_text_section" ? "" : "\n");
    return node.type === "rich_text_preformatted" ? `\`\`\`\n${body}\n\`\`\`` : body;
  }
  const title =
    typeof node.title === "string"
      ? typeof node.title_link === "string"
        ? `<${node.title_link}|${node.title}>`
        : node.title
      : "";
  return [node.pretext, title, node.text ?? node.value ?? node.fallback, node.fields]
    .map((entry) => blockText(entry, depth + 1))
    .filter(Boolean)
    .join("\n");
}
function messageText(message: typeof Message.Type) {
  const main = message.text?.trim() ? message.text : blockText(message.blocks);
  const attachments = blockText(message.attachments);
  return [main, attachments && !main.includes(attachments) ? attachments : ""]
    .filter(Boolean)
    .join("\n\n");
}
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
    (groups ??= read("usergroups.list", { include_users: "true" }).then(decodeGroups));
  const names: { users: Record<string, string>; groups: Record<string, string> } = {
    users: {},
    groups: {},
  };
  const profiles = new Map<string, Promise<string>>();
  let profilesAvailable = true;
  const displayName = (id: string): Promise<string> => {
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
    context: string,
    url?: string,
  ) => {
    if (message.user === identity.user_id) return;
    const id = `${channel}:${message.ts}`;
    const raw = `${messageText(message)}${context ? `\n\nThread context:\n${context}` : ""}`.slice(
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
    if (raw.includes("<!subteam^"))
      for (const group of (await getGroups()).usergroups)
        names.groups[group.id] = group.handle || group.name || group.id;
    items.set(
      id,
      readableSlackItem(
        {
          id,
          source: "slack",
          connectionId: `${identity.team_id}:${identity.user_id}`,
          groupId: `${channel}:${message.thread_ts ?? message.ts}`,
          location,
          title: (message.text ?? "Slack notification").split("\n")[0]!.slice(0, 250),
          author:
            (message.user && names.users[message.user]) ||
            message.username ||
            message.bot_profile?.name ||
            message.user ||
            "Slack",
          content: raw,
          url:
            url ??
            `https://app.slack.com/client/${identity.team_id}/${channel}/thread/${channel}-${message.thread_ts ?? message.ts}`,
          occurredAt: DateTime.formatIso(DateTime.makeUnsafe(Number(message.ts) * 1000)),
        },
        names,
      ),
    );
  };
  const contextFor = async (channel: string, message: typeof Message.Type) => {
    if (!message.thread_ts) return "";
    const response = decodeHistory(
      await read("conversations.replies", { channel, ts: message.thread_ts, limit: "15" }),
    );
    const context = (response.messages ?? [])
      .filter((entry) => entry.ts !== message.ts)
      .map((entry) => `${entry.user || entry.username || "Slack"}: ${messageText(entry)}`)
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
              oldest: String(sinceMillis / 1000),
              inclusive: "true",
              limit: "100",
              cursor: historyCursor,
            }),
          );
          for (const message of history.messages ?? []) {
            if (Number(message.ts) * 1000 < sinceMillis || message.user === identity.user_id)
              continue;
            await append(
              channel.id,
              channel.name ?? `DM · ${channel.user ? await displayName(channel.user) : channel.id}`,
              message,
              await contextFor(channel.id, message),
            );
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
  if (categories.includes("mentions")) queries.push(`<@${identity.user_id}>`);
  if (categories.includes("group-mentions")) {
    const groups = await getGroups();
    for (const group of groups.usergroups)
      if (group.users?.includes(identity.user_id)) queries.push(`<!subteam^${group.id}>`);
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
          if (native) message = { ...hit, ...native };
        }
        await append(
          message.channel.id,
          `#${message.channel.name}`,
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
