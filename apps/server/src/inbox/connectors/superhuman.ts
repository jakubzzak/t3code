import * as Schema from "effect/Schema";
import type { InboxSourceItem } from "@t3tools/contracts";
import { emailText } from "@t3tools/shared/emailText";
export type SuperhumanRead = (
  name: string,
  arguments_: Record<string, unknown>,
) => Promise<unknown>;
export const SUPERHUMAN_READ_TOOLS = new Set([
  "list_accounts",
  "list_labels",
  "list_splits",
  "list_threads",
  "get_thread",
]);
const Accounts = Schema.Struct({
  accounts: Schema.NullOr(
    Schema.Array(Schema.Struct({ accountEmail: Schema.String, isPrimary: Schema.Boolean })),
  ),
});
const Thread = Schema.Struct({
  thread_id: Schema.String,
  subject: Schema.String,
  snippet: Schema.String,
  last_message_at: Schema.String,
  last_message_id: Schema.String,
  labels: Schema.NullOr(Schema.Array(Schema.String)),
  splits: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.String))),
  truncated: Schema.optionalKey(Schema.Boolean),
  messages: Schema.optionalKey(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          message_id: Schema.String,
          from: Schema.String,
          sent_at: Schema.String,
          body: Schema.optionalKey(Schema.String),
          snippet: Schema.String,
          is_draft: Schema.optionalKey(Schema.Boolean),
        }),
      ),
    ),
  ),
  comments: Schema.optionalKey(
    Schema.NullOr(
      Schema.Array(
        Schema.Struct({
          comment_id: Schema.String,
          body: Schema.String,
          author: Schema.optionalKey(Schema.String),
          author_name: Schema.optionalKey(Schema.String),
          created_at: Schema.optionalKey(Schema.String),
          reactions: Schema.optionalKey(
            Schema.NullOr(
              Schema.Array(
                Schema.Struct({
                  emoji: Schema.String,
                  reaction_count: Schema.Number,
                  by_me: Schema.optionalKey(Schema.Boolean),
                }),
              ),
            ),
          ),
        }),
      ),
    ),
  ),
});
const Page = Schema.Struct({
  threads: Schema.NullOr(Schema.Array(Thread)),
  next_cursor: Schema.optionalKey(Schema.String),
});
const decodeAccounts = Schema.decodeUnknownSync(Accounts);
const decodeThread = Schema.decodeUnknownSync(Thread);
const decodePage = Schema.decodeUnknownSync(Page);
/** Uses provider split membership; it never substitutes a mail-provider importance heuristic. */
export async function readSuperhumanInbox(
  read: SuperhumanRead,
  selectedAccounts: ReadonlyArray<string>,
  categories: ReadonlyArray<string>,
): Promise<ReadonlyArray<InboxSourceItem>> {
  if (!selectedAccounts.length || !categories.length)
    throw new Error("Select a Superhuman account and at least one split or label.");
  const { accounts } = decodeAccounts(await read("list_accounts", {}));
  const items = new Map<string, InboxSourceItem>();
  for (const email of selectedAccounts) {
    if (!accounts?.some((account) => account.accountEmail === email))
      throw new Error("A selected Superhuman account is no longer connected.");
    const threads = new Map<string, typeof Thread.Type>();
    for (const category of categories) {
      const filter = category.startsWith("split:")
        ? { split: category.slice(6) }
        : category.startsWith("label:")
          ? { labels: [category.slice(6)] }
          : null;
      if (!filter) throw new Error("Unknown Superhuman relevance filter.");
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = decodePage(
          await read("list_threads", {
            acting_email: email,
            ...filter,
            limit: 50,
            ...(cursor ? { cursor } : {}),
          }),
        );
        for (const thread of page.threads ?? []) threads.set(thread.thread_id, thread);
        cursor = page.next_cursor;
        if (cursor && seen.has(cursor))
          throw new Error("Superhuman returned a repeated page cursor.");
        if (cursor) seen.add(cursor);
      } while (cursor);
    }
    for (const thread of threads.values()) {
      const full = decodeThread(
        await read("get_thread", {
          acting_email: email,
          thread_id: thread.thread_id,
          include_comments: true,
          include_drafts: false,
          message_limit: 100,
        }),
      );
      const messages = full.messages?.filter((message) => !message.is_draft) ?? [];
      const content =
        [
          ...messages.map(
            (message) =>
              `${message.from} · ${message.sent_at}\n${emailText(message.body ?? "").trim() || emailText(message.snippet)}`,
          ),
          ...(full.comments ?? []).map(
            (comment) =>
              `${comment.author_name ?? comment.author ?? "Comment"} · ${comment.created_at ?? ""}\n${emailText(comment.body)}${comment.reactions?.length ? `\nReactions: ${comment.reactions.map((reaction) => `${reaction.emoji} ${reaction.reaction_count}${reaction.by_me ? " (including you)" : ""}`).join(", ")}` : ""}`,
          ),
          ...(full.truncated
            ? [
                "Some middle messages are omitted by Superhuman. Open the source for the complete thread.",
              ]
            : []),
        ].join("\n\n") || emailText(full.snippet);
      const key = `${email}:${full.thread_id}`;
      items.set(key, {
        id: full.thread_id,
        source: "superhuman",
        connectionId: email,
        groupId: full.thread_id,
        location: [...(full.splits ?? []), ...(full.labels ?? [])].join(" · "),
        title: full.subject,
        author: messages.at(-1)?.from ?? email,
        contentFormat: "text",
        content:
          content.length > 32000
            ? `${content.slice(0, 31900)}\n\nPreview shortened. Open the source for more.`
            : content,
        url: `https://mail.superhuman.com/${encodeURIComponent(email)}/thread/${encodeURIComponent(full.thread_id)}`,
        occurredAt: full.last_message_at,
      });
    }
  }
  return [...items.values()];
}
