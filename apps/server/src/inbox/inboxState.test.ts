import { describe, expect, it } from "vite-plus/test";
import { ProjectId, ThreadId, type InboxSourceItem } from "@t3tools/contracts";
import { readableSlackItem } from "./notificationContent.ts";
import { inboxIdentity, ingestInboxItem, restoreInboxState } from "./inboxState.ts";
const project = ProjectId.make("a");
const message: InboxSourceItem = {
  id: "message1",
  source: "slack",
  connectionId: "workspace",
  groupId: "C1:123",
  location: "#launch",
  title: "Review the launch",
  author: "Alex",
  content: "Please check the launch notes",
  url: "https://slack.com/archives/C1/p123",
  occurredAt: "2026-10-22T09:00:00Z",
};
describe("notification lifecycle", () => {
  it("groups native activity without losing the triggering messages or duplicating deliveries", () => {
    const first = ingestInboxItem(project, message);
    const second = ingestInboxItem(
      project,
      {
        ...message,
        id: "message2",
        content: "Tomorrow, please",
        occurredAt: "2026-10-22T10:00:00Z",
      },
      first,
    );
    expect(second.items.map((item) => item.id)).toEqual(["message1", "message2"]);
    expect(ingestInboxItem(project, message, second)).toBe(second);
  });
  it("isolates the same source group across projects and connections", () => {
    expect(inboxIdentity(project, message)).not.toBe(inboxIdentity(ProjectId.make("b"), message));
    expect(inboxIdentity(project, message)).not.toBe(
      inboxIdentity(project, { ...message, connectionId: "other" }),
    );
  });
  it("new activity keeps a delegated chat and becomes unread without starting another agent", () => {
    const first = ingestInboxItem(project, message);
    const delegated = {
      ...first,
      state: {
        ...first.state,
        threadId: ThreadId.make("chat"),
        placement: "delegated" as const,
        read: true,
      },
      agentStatus: "stopped" as const,
    };
    const next = ingestInboxItem(project, { ...message, id: "message2" }, delegated);
    expect(next.state).toMatchObject({ threadId: "chat", placement: "delegated", read: false });
    expect(next.agentStatus).toBe("stopped");
  });
  it("undo restores intake but retains the linked chat and requests a stop, not deletion", () => {
    const first = ingestInboxItem(project, message);
    const delegated = {
      ...first,
      state: { ...first.state, placement: "delegated" as const, threadId: ThreadId.make("chat") },
      agentStatus: "running" as const,
    };
    const restored = restoreInboxState(delegated, first.state);
    expect(restored.state).toMatchObject({ placement: "active", threadId: "chat", read: false });
    expect(restored.agentStatus).toBe("stop-requested");
  });
});

it("name enrichment repairs a Slack message without reopening it or marking it unread", () => {
  const raw = { ...message, content: "<@U123> review <https://example.com|the report>" };
  const fallback = readableSlackItem(raw);
  const first = ingestInboxItem(project, fallback);
  const settled = {
    ...first,
    state: {
      ...first.state,
      read: true,
      placement: "resolved" as const,
      threadId: ThreadId.make("chat"),
    },
    analysisAttempts: 3,
    processingError: "AI summary not available",
  };
  const enriched = ingestInboxItem(
    project,
    readableSlackItem(raw, { users: { U123: "Alex" } }),
    settled,
  );
  expect(enriched.state).toEqual(settled.state);
  expect(enriched.items[0]?.content).toContain("@Alex");
  expect(enriched.analysisAttempts).toBe(0);
  expect(enriched.processingError).toBeNull();
});
