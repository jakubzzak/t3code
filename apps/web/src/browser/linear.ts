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
