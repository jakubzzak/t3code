import type { LinearIssue } from "@t3tools/contracts";

const priorityNames = ["No priority", "Urgent", "High", "Medium", "Low"] as const;
const filledCircle = "M8 1a7 7 0 1 1 0 14A7 7 0 0 1 8 1Z";
const statusCutouts: Record<string, string> = {
  completed: "M4 8l1.1-1.1L7 8.8l3.9-3.9L12 6l-5 5Z",
  canceled: "M5.1 4 8 6.9 10.9 4 12 5.1 9.1 8l2.9 2.9-1.1 1.1L8 9.1 5.1 12 4 10.9 6.9 8 4 5.1Z",
  duplicate: "M4 8l4-4 1.2 1.2-4 4ZM6.8 10.8l4-4L12 8l-4 4Z",
  triage: "M3 8l3.5-3.5v2.75h3V4.5L13 8l-3.5 3.5V8.75h-3v2.75Z",
};

function StatusShape({ state }: { state: NonNullable<LinearIssue["state"]> }) {
  const cutout = statusCutouts[state.type];
  if (cutout) return <path fillRule="evenodd" d={`${filledCircle}${cutout}`} />;
  if (state.type === "backlog") {
    return (
      <circle
        cx="8"
        cy="8"
        r="6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="1.5 1.6416"
      />
    );
  }
  const progress = Math.max(0.05, Math.min(0.95, state.progress));
  const angle = progress * Math.PI * 2;
  return (
    <>
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.5" />
      {state.type === "started" && (
        <path
          d={`M8 8V3.75a4.25 4.25 0 ${progress > 0.5 ? 1 : 0} 1 ${4.25 * Math.sin(angle)} ${4.25 * (1 - Math.cos(angle))}Z`}
        />
      )}
    </>
  );
}

export function LinearPriorityIcon({
  priority,
  closed = false,
}: {
  priority: NonNullable<LinearIssue["priority"]>;
  closed?: boolean;
}) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0"
      fill="currentColor"
      style={{ color: priority === 1 && !closed ? "#ff6b26" : "#999a9c" }}
      role="img"
      aria-label={`Priority: ${priorityNames[priority]}`}
    >
      <title>{priorityNames[priority]}</title>
      {priority === 0 ? (
        <path d="M1 7h3v2H1Zm5.5 0h3v2h-3ZM12 7h3v2h-3Z" />
      ) : priority === 1 ? (
        <path
          fillRule="evenodd"
          d="M3 1h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2Zm4.1 3 .3 5h1.2l.3-5Zm.9 6a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"
        />
      ) : (
        <>
          <rect x="1" y="9" width="3" height="6" rx="1" />
          <rect x="6" y="5" width="3" height="10" rx="1" opacity={priority <= 3 ? 1 : 0.4} />
          <rect x="11" y="1" width="3" height="14" rx="1" opacity={priority === 2 ? 1 : 0.4} />
        </>
      )}
    </svg>
  );
}

export function LinearStatusIcon({ state }: { state: NonNullable<LinearIssue["state"]> }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="size-3.5 shrink-0"
      fill="currentColor"
      style={{ color: state.color }}
      role="img"
      aria-label={`Status: ${state.name}`}
    >
      <title>{state.name}</title>
      <StatusShape state={state} />
    </svg>
  );
}

/** Linear's priority and workflow glyphs, with the team's own status colors. */
export function LinearIssueIcons({ issue }: { issue: LinearIssue }) {
  const { priority, state } = issue;
  const closed =
    state?.type === "completed" || state?.type === "canceled" || state?.type === "duplicate";
  return (
    <>
      {priority !== undefined && <LinearPriorityIcon priority={priority} closed={closed} />}
      {state && <LinearStatusIcon state={state} />}
    </>
  );
}
