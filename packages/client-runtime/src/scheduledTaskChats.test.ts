import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { automationArchiveConfirmation, scheduledTaskChats } from "./scheduledTaskChats.ts";

const environmentId = EnvironmentId.make("local");
const projectId = ProjectId.make("project");
const threadId = ThreadId.make("idle");
const chat = {
  id: threadId,
  environmentId,
  projectId,
  title: "Daily brief",
  branch: "main",
  worktreePath: null,
  archivedAt: null,
  deletedAt: null,
  updatedAt: "2026-10-01T00:00:00Z",
  settledAt: null,
};

describe("scheduled task destinations", () => {
  it("includes resolved chats, scopes to one environment/project, and orders recent activity first", () => {
    const threads = [
      chat,
      {
        ...chat,
        id: ThreadId.make("resolved"),
        settledAt: "2026-10-02T00:00:00Z",
        updatedAt: "2026-10-02T00:00:00Z",
      },
      { ...chat, id: ThreadId.make("archived"), archivedAt: "2026-10-02T00:00:00Z" },
      { ...chat, id: ThreadId.make("deleted"), deletedAt: "2026-10-02T00:00:00Z" },
      { ...chat, environmentId: EnvironmentId.make("remote") },
      { ...chat, projectId: ProjectId.make("other") },
    ];
    expect(scheduledTaskChats(threads, environmentId, projectId).map((item) => item.id)).toEqual([
      "resolved",
      "idle",
    ]);
    expect(threads[0]).toBe(chat);
    expect(scheduledTaskChats(threads, environmentId, projectId, " MAIN ")).toHaveLength(2);
    expect(scheduledTaskChats(threads, environmentId, projectId, "missing")).toEqual([]);
  });
  it("names all attached automations and gives a settings recovery path", () => {
    expect(automationArchiveConfirmation([], threadId)).toBeNull();
    const tasks = [
      { title: "Daily brief", threadId },
      { title: "Weekly review", threadId },
      { title: "Elsewhere", threadId: ThreadId.make("elsewhere") },
    ];
    const single = automationArchiveConfirmation(tasks.slice(0, 1), threadId)!;
    expect(single.title).toBe("Archive chat and pause automation?");
    expect(single.message).toContain("“Daily brief”");
    const multiple = automationArchiveConfirmation(tasks, threadId)!;
    expect(multiple.message).toContain("“Daily brief”, “Weekly review”");
    expect(multiple.message).not.toContain("Elsewhere");
    expect(multiple.message).toContain("pause these automations");
    expect(multiple.message).toContain("Settings → Scheduled tasks");
  });
});
