import * as Schema from "effect/Schema";
import type { InboxSlackImage } from "@t3tools/contracts";
export const SlackFile = Schema.Struct({
  id: Schema.String,
  title: Schema.optionalKey(Schema.String),
  name: Schema.optionalKey(Schema.String),
  mimetype: Schema.optionalKey(Schema.String),
  url_private: Schema.optionalKey(Schema.String),
  thumb_720: Schema.optionalKey(Schema.String),
  permalink: Schema.optionalKey(Schema.String),
});
export const Message = Schema.Struct({
  ts: Schema.String,
  text: Schema.optionalKey(Schema.NullOr(Schema.String)),
  user: Schema.optionalKey(Schema.NullOr(Schema.String)),
  username: Schema.optionalKey(Schema.NullOr(Schema.String)),
  bot_profile: Schema.optionalKey(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
  thread_ts: Schema.optionalKey(Schema.String),
  reply_count: Schema.optionalKey(Schema.Number),
  latest_reply: Schema.optionalKey(Schema.String),
  blocks: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  attachments: Schema.optionalKey(Schema.Array(Schema.Unknown)),
  files: Schema.optionalKey(Schema.Array(SlackFile)),
});
/** Keep references only; image bytes are fetched on demand through the environment. */
export function messageImages(message: typeof Message.Type): InboxSlackImage[] {
  return (message.files ?? [])
    .filter(
      (file) => /^image\/(?:png|jpeg|gif|webp)$/.test(file.mimetype ?? "") && file.url_private,
    )
    .slice(0, 10)
    .map((file) => ({
      id: file.id,
      name: file.title || file.name || "Slack image",
      url: file.thumb_720 || file.url_private!,
      ...(file.permalink ? { permalink: file.permalink } : {}),
    }));
}
export const History = Schema.Struct({
  ok: Schema.Boolean,
  messages: Schema.optionalKey(Schema.Array(Message)),
  has_more: Schema.optionalKey(Schema.Boolean),
  response_metadata: Schema.optionalKey(
    Schema.Struct({ next_cursor: Schema.optionalKey(Schema.String) }),
  ),
});

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
export function messageText(message: typeof Message.Type) {
  const main = message.text?.trim() ? message.text : blockText(message.blocks);
  const attachments = blockText(message.attachments);
  return [main, attachments && !main.includes(attachments) ? attachments : ""]
    .filter(Boolean)
    .join("\n\n");
}
