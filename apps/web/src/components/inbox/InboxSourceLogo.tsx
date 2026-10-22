import type { InboxSource } from "@t3tools/contracts";
import { LinearIcon } from "../linear/LinearIcon";
export function InboxSourceLogo({ source }: { source: InboxSource }) {
  if (source === "linear")
    return (
      <LinearIcon
        role="img"
        aria-hidden={false}
        aria-label="Linear"
        className="size-3.5 shrink-0"
      />
    );
  if (source === "slack")
    return <img alt="Slack" className="size-3.5 shrink-0" src="/icons/slack.svg" />;
  return <img alt="Superhuman" className="size-3.5 shrink-0" src="/icons/superhuman.png" />;
}
