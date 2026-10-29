import type { PreviewSessionSnapshot } from "@t3tools/contracts";

/** A page title is usable only when its leading issue ID matches the current route. */
export function linearIssueTabLabel(navigation: PreviewSessionSnapshot["navStatus"]) {
  if (navigation._tag === "Idle") return null;
  let url: URL;
  try {
    url = new URL(navigation.url);
  } catch {
    return null;
  }
  if (url.origin !== "https://linear.app") return null;
  const identifier = url.pathname
    .match(
      /^\/[a-zA-Z0-9][a-zA-Z0-9-]{0,127}\/issue\/([a-zA-Z][a-zA-Z0-9]*-[0-9]+)(?:\/[^/]+)?\/?$/,
    )?.[1]
    ?.toUpperCase();
  if (!identifier) return null;

  // Linear's issue document title is `<identifier> <original name>`. During
  // navigation the preview can still carry the previous document's title.
  const title = navigation.title.trim();
  const name = title.startsWith(`${identifier} `) ? title.slice(identifier.length + 1).trim() : "";
  return {
    identifier,
    name,
    shortName: shortIssueName(name),
    label: name ? `${identifier} · ${name}` : identifier,
  };
}

const SHORT_NAME_LENGTH = 15;

/** The first 15 characters of the name, marked with `..` when cut. */
function shortIssueName(name: string) {
  const characters = Array.from(name);
  if (characters.length <= SHORT_NAME_LENGTH) return name;
  return `${characters.slice(0, SHORT_NAME_LENGTH).join("").trimEnd()}..`;
}

/** Initial destination only: an existing surface owns its subsequent navigation. */
export function linearInitialUrl(
  workspace: string,
  branch: string | null | undefined,
): string | null {
  const slug = workspace.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9-]{0,127}$/.test(slug)) return null;
  const issue = branch?.match(
    /(?:^|[^a-zA-Z0-9])([a-zA-Z][a-zA-Z0-9]*-[0-9]+)(?=$|[^a-zA-Z0-9])/i,
  )?.[1];
  return `https://linear.app/${slug}/${issue ? `issue/${issue.toUpperCase()}` : "my-issues"}`;
}
