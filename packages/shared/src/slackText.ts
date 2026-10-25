export type SlackNames = {
  users?: Readonly<Record<string, string>>;
  groups?: Readonly<Record<string, string>>;
  viewerUserId?: string;
  memberGroupIds?: ReadonlyArray<string>;
  emojis?: Readonly<Record<string, string>>;
};
export type SlackMention = { kind: "user" | "group"; id: string; label: string; personal: boolean };
const nativeMentions =
  /```[\s\S]*?```|`[^`\n]*`|<(@([UW][A-Z0-9]+)|!subteam\^([A-Z0-9]+))(?:\|([^>]*))?>/g;
/** Retain authentic references only; plain @names and code never become mentions. */
export function slackMentions(value: string, names: SlackNames = {}): SlackMention[] {
  const mentions = new Map<string, SlackMention>();
  for (const match of value.matchAll(nativeMentions)) {
    if (match[0].startsWith("`")) continue;
    const kind = match[2] ? "user" : "group";
    const id = match[2] || match[3]!;
    const label =
      (kind === "user" ? names.users?.[id] : names.groups?.[id]) ||
      match[4]?.replace(/^@/, "") ||
      id;
    mentions.set(`${kind}:${id}`, {
      kind,
      id,
      label: label.slice(0, 200),
      personal:
        kind === "user" ? id === names.viewerUserId : (names.memberGroupIds?.includes(id) ?? false),
    });
    if (mentions.size === 100) break;
  }
  return [...mentions.values()];
}
export const slackMentionHref = (mention: Pick<SlackMention, "kind" | "id">) =>
  `slack-mention:${mention.kind}:${mention.id}`;
const decode = (value: string) =>
  value.replace(/&(?:amp|lt|gt);/g, (entity) =>
    entity === "&amp;" ? "&" : entity === "&lt;" ? "<" : ">",
  );
const escape = (value: string) => value.replace(/[\\`*_{}[\]<>#!|~]/g, "\\$&");
export function slackLinkUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:", "mailto:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
/** Convert Slack's mrkdwn as data. Literal Markdown/HTML cannot introduce images or actions. */
export function slackText(
  value: string,
  names: SlackNames = {},
  format: "markdown" | "text" | "preview" | "rich" = "markdown",
): string {
  const markdown = format === "markdown" || format === "rich";
  const mentions = format === "rich" ? slackMentions(value, names) : [];
  const literal = (text: string, emojify = true) => {
    const decoded = decode(text).replace(
      /(^|\n)([UW][A-Z0-9]+):/g,
      (_, prefix: string, id: string) => `${prefix}${names.users?.[id] || id}:`,
    );
    const emoji = emojify
      ? decoded.replace(/:([\w+-]+):/g, (match, name: string) => names.emojis?.[name] ?? match)
      : decoded;
    return markdown ? escape(emoji) : emoji;
  };
  const link = (url: string, label: string) => {
    const safe = slackLinkUrl(decode(url));
    if (markdown && safe)
      return `[${literal(label, label !== url)}](<${safe.replace(/>/g, "%3E")}>)`;
    return format === "text" && safe && decode(label) !== decode(url)
      ? `${literal(label)} (${safe})`
      : literal(label);
  };
  const token = /```[\s\S]*?```|`[^`\n]*`|<[^>\n]+>|\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~/g;
  let result = "";
  let offset = 0;
  for (const match of value.matchAll(token)) {
    result += literal(value.slice(offset, match.index));
    const text = match[0];
    if (text.startsWith("`")) result += markdown ? text : text.replace(/^`{1,3}|`{1,3}$/g, "");
    else if (text.startsWith("<")) {
      const body = text.slice(1, -1);
      const [reference, ...labels] = body.split("|");
      const label = labels.join("|");
      const user = reference!.match(/^@([UW][A-Z0-9]+)$/);
      const group = reference!.match(/^!subteam\^([A-Z0-9]+)$/);
      if (user || group) {
        const kind = user ? "user" : "group";
        const id = user?.[1] ?? group![1]!;
        const mention = mentions.find((entry) => entry.kind === kind && entry.id === id);
        const text = literal(
          `@${mention?.label || (user ? names.users?.[id] : names.groups?.[id]) || label.replace(/^@/, "") || id}`,
        );
        result += mention ? `[${text}](${slackMentionHref(mention)})` : text;
      } else if (reference!.startsWith("#")) result += literal(`#${label || reference!.slice(1)}`);
      else if (["!here", "!channel", "!everyone"].includes(reference!))
        result += literal(reference!.replace("!", "@"));
      else if (reference!.startsWith("!date^")) result += literal(label || "Date");
      else if (slackLinkUrl(decode(reference!))) result += link(reference!, label || reference!);
      else result += literal(label || text);
    } else {
      const inner = slackText(text.slice(1, -1), names, format);
      const marker = text[0] === "*" ? "**" : text[0] === "~" ? "~~" : "_";
      result += markdown ? `${marker}${inner}${marker}` : inner;
    }
    offset = match.index + text.length;
  }
  result += literal(value.slice(offset));
  return result;
}
