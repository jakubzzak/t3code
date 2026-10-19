import type { EnvironmentId, ProjectId, ScheduledTask, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "./state/models.ts";

/** Chat summaries include resolved conversations; only archived/deleted destinations are excluded. */
export function scheduledTaskChats<
  T extends Pick<
    EnvironmentThreadShell,
    | "id"
    | "environmentId"
    | "projectId"
    | "title"
    | "branch"
    | "worktreePath"
    | "archivedAt"
    | "deletedAt"
    | "updatedAt"
  >,
>(
  threads: ReadonlyArray<T>,
  environmentId: EnvironmentId,
  projectId: ProjectId | string | null,
  query = "",
) {
  const search = query.trim().toLocaleLowerCase();
  return threads
    .filter(
      (thread) =>
        thread.environmentId === environmentId &&
        thread.projectId === projectId &&
        thread.archivedAt === null &&
        thread.deletedAt === null &&
        (!search ||
          `${thread.title} ${thread.branch ?? ""} ${thread.worktreePath ?? ""}`
            .toLocaleLowerCase()
            .includes(search)),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
}

export function automationArchiveConfirmation(
  tasks: ReadonlyArray<Pick<ScheduledTask, "threadId" | "title">>,
  threadId: ThreadId,
) {
  const bound = tasks.filter((task) => task.threadId === threadId);
  if (bound.length === 0) return null;
  const plural = bound.length > 1;
  const names = bound.map((task) => `“${task.title}”`).join(", ");
  return {
    title: plural ? "Archive chat and pause automations?" : "Archive chat and pause automation?",
    message: `This chat is used by ${names}. Archiving this chat will pause ${plural ? "these automations" : "the automation"}. You can reconfigure ${plural ? "them" : "it"} in Settings → Scheduled tasks.`,
  };
}
