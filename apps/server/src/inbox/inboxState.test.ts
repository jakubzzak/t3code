import * as DateTime from "effect/DateTime";
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
  it("ignores replayed events outside the retained 50 without clearing read state or analysis", () => {
    const events = Array.from({ length: 51 }, (_, index) => ({
      ...message,
      source: "linear" as const,
      id: `event-${index}`,
      occurredAt: DateTime.formatIso(
        DateTime.makeUnsafe(Date.parse(message.occurredAt) + index * 1000),
      ),
    }));
    let current = ingestInboxItem(project, events[0]!);
    for (const event of events.slice(1)) current = ingestInboxItem(project, event, current);
    current = {
      ...current,
      state: { ...current.state, read: true },
      analysisAttempts: 3,
      processingError: "AI summary not available",
    };
    const before = current;
    for (const event of events) current = ingestInboxItem(project, event, current);
    expect(current).toBe(before);
    const edited = ingestInboxItem(
      project,
      { ...events.at(-1)!, content: "Updated request" },
      current,
    );
    expect(edited.state.read).toBe(false);
    expect(edited.analysisVersion).toBe(before.analysisVersion + 1);
    const fresh = ingestInboxItem(
      project,
      { ...events.at(-1)!, id: "new", occurredAt: "2026-10-22T10:00:00Z" },
      before,
    );
    expect(fresh.items.at(-1)?.id).toBe("new");
    expect(fresh.state.read).toBe(false);
  });
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

it("keeps cached history and its page cursor when intake repeats the same Slack snapshot", () => {
  const msg = (ts: string) => ({
    ts,
    author: "Alex",
    content: "Message",
    formattedContent: "Message",
    occurredAt: message.occurredAt,
  });
  const thread = {
    channelId: "C1",
    ts: "123",
    root: msg("123"),
    latestReplyTs: "140",
    replyCount: 20,
    messages: [msg("124"), msg("140")],
    nextCursor: "first",
  };
  const incoming = { ...message, slackThread: thread };
  const first = ingestInboxItem(project, incoming);
  const cached = {
    ...first,
    state: { ...first.state, read: true },
    slackThread: {
      ...thread,
      messages: [msg("124"), msg("125"), msg("140")],
      nextCursor: "second",
    },
  };
  expect(ingestInboxItem(project, incoming, cached)).toBe(cached);
  expect(cached.slackThread.nextCursor).toBe("second");
});

it("enriches Linear presentation without reopening settled work, but invalidates cached history for new activity", () => {
  const item = { ...message, source: "linear" as const, groupId: "issue" };
  const issue = {
    id: "issue",
    title: "Review",
    description: "Context",
    comments: [],
    commentsComplete: true,
  };
  const before = {
    ...ingestInboxItem(project, item),
    linearIssue: issue,
    state: {
      read: true,
      placement: "resolved" as const,
      snoozedUntil: null,
      threadId: ThreadId.make("chat"),
    },
    processingError: "AI summary not available",
    analysisAttempts: 3,
  };
  const formatted = ingestInboxItem(
    project,
    { ...item, linearIssue: { ...issue, commentsComplete: false } },
    before,
  );
  expect(formatted.state).toEqual(before.state);
  expect(formatted.analysisVersion).toBe(before.analysisVersion);
  expect(formatted.processingError).toBe(before.processingError);
  expect(formatted.linearIssue).toEqual(issue);
  const next = ingestInboxItem(
    project,
    { ...item, id: "new", content: "A new request" },
    formatted,
  );
  expect(next.linearIssue).toBeUndefined();
  expect(next.state.read).toBe(false);
});
