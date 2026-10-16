import type { LinearIssue } from "@t3tools/contracts";
import { UserRoundIcon } from "lucide-react";
import { useState } from "react";
import { LinearIssueIcons } from "./LinearIssueIcons";
import { Tooltip, TooltipTrigger, TooltipPopup } from "../ui/tooltip";
import styles from "./linearIssueRow.module.css";

function Assignee({ assignee }: { assignee: LinearIssue["assignee"] }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const name = assignee?.name ?? (assignee === null ? "Unassigned" : "Assignee unavailable");
  const avatar = assignee?.avatarUrl;
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className="flex size-4 shrink-0 items-center justify-center" />}
        tabIndex={-1}
      >
        {avatar && avatar !== failedUrl ? (
          <img
            src={avatar}
            alt={`Assignee: ${name}`}
            className="size-4 rounded-full object-cover"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailedUrl(avatar)}
          />
        ) : (
          <UserRoundIcon
            className="size-3.5 text-muted-foreground"
            role="img"
            aria-label={`Assignee: ${name}`}
          />
        )}
      </TooltipTrigger>
      <TooltipPopup>{name}</TooltipPopup>
    </Tooltip>
  );
}

export function LinearIssueRow({
  issue,
  showAssignee,
  disabled,
  onSelect,
}: {
  issue: LinearIssue;
  showAssignee: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`${styles.row} flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm leading-5 hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50`}
      onClick={onSelect}
    >
      <span className="flex h-5 shrink-0 items-center gap-2">
        <LinearIssueIcons issue={issue} />
        {showAssignee && <Assignee assignee={issue.assignee} />}
        <span className="text-xs text-muted-foreground">{issue.identifier}</span>
      </span>
      <Tooltip>
        <TooltipTrigger
          render={<span className={`${styles.title} min-w-0 flex-1`} />}
          tabIndex={-1}
        >
          <span className={styles.collapsed} aria-hidden="true">
            {issue.title}
          </span>
          <span className={styles.expanded}>{issue.title}</span>
        </TooltipTrigger>
        <TooltipPopup>{issue.title}</TooltipPopup>
      </Tooltip>
    </button>
  );
}
