export type SlackNames = {
  users?: Readonly<Record<string, string>>;
  groups?: Readonly<Record<string, string>>;
};
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
  format: "markdown" | "text" | "preview" = "markdown",
): string {
  const markdown = format === "markdown";
  const literal = (text: string) => {
    const decoded = decode(text).replace(
      /(^|\n)([UW][A-Z0-9]+):/g,
      (_, prefix: string, id: string) => `${prefix}${names.users?.[id] || id}:`,
    );
    return markdown ? escape(decoded) : decoded;
  };
  const link = (url: string, label: string) => {
    const safe = slackLinkUrl(decode(url));
    if (markdown && safe) return `[${literal(label)}](<${safe.replace(/>/g, "%3E")}>)`;
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
      if (user)
        result += literal(`@${names.users?.[user[1]!] || label.replace(/^@/, "") || user[1]}`);
      else if (group)
        result += literal(`@${names.groups?.[group[1]!] || label.replace(/^@/, "") || group[1]}`);
      else if (reference!.startsWith("#")) result += literal(`#${label || reference!.slice(1)}`);
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
