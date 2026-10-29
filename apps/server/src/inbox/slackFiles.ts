/** Slack can put external URLs in file records. Credentials must stay on Slack's file host. */
export function isSlackFileUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "files.slack.com" &&
      !url.username &&
      !url.password &&
      !url.port
    );
  } catch {
    return false;
  }
}
