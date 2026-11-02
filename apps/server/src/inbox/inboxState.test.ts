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

describe("reply attention", () => {
  const reply = (id: string, at: string, isSelf: boolean) => ({
    ...message,
    id,
    content: id,
    occurredAt: at,
    replyActivity: [{ id, occurredAt: at, isSelf }],
  });
  const incoming = reply("incoming", "2026-10-22T10:00:00.000Z", false);
  const own = reply("own", "2026-10-22T11:00:00.000Z", true);
  const later = reply("later", "2026-10-22T12:00:00.000Z", false);

  it("marks self replies read without moving or promoting the notification", () => {
    const first = ingestInboxItem(project, incoming);
    const settled = { ...first, state: { ...first.state, placement: "resolved" as const } };
    const next = ingestInboxItem(project, own, settled);
    expect(next.state).toEqual({ ...settled.state, read: true });
    expect(next.updatedAt).toBe(settled.updatedAt);
    expect(next.items.at(-1)?.content).toBe("own");
  });

  it("reopens the same settled notification on another person's later reply, retaining its chat", () => {
    const first = ingestInboxItem(project, incoming);
    const settled = {
      ...first,
      state: {
        ...first.state,
        placement: "resolved" as const,
        read: true,
        threadId: ThreadId.make("linked"),
      },
      linkedChatSettled: true,
    };
    const next = ingestInboxItem(project, later, settled);
    expect(next.id).toBe(first.id);
    expect(next.state).toEqual({ ...settled.state, placement: "active", read: false });
    expect(next.linkedChatSettled).toBe(true);
  });

  it("preserves manual triage on replay, context refresh and older deliveries", () => {
    const first = ingestInboxItem(project, own, ingestInboxItem(project, incoming));
    const manual = {
      ...first,
      state: { ...first.state, read: false, placement: "resolved" as const },
    };
    const refreshed = ingestInboxItem(project, { ...own, content: "Updated context" }, manual);
    expect(refreshed.state).toEqual(manual.state);
    expect(ingestInboxItem(project, incoming, refreshed).state).toEqual(manual.state);
    const latest = ingestInboxItem(project, later, refreshed);
    expect(latest.state).toMatchObject({ placement: "active", read: false });
  });

  it("uses source order for multiple replies in a mail snapshot", () => {
    const first = ingestInboxItem(project, incoming);
    const settled = { ...first, state: { ...first.state, placement: "resolved" as const } };
    const newestSelf = { id: "answer", occurredAt: "2026-10-22T13:00:00.000Z", isSelf: true };
    const next = ingestInboxItem(
      project,
      {
        ...later,
        replyActivity: [newestSelf, ...later.replyActivity],
      },
      settled,
    );
    expect(next.state).toMatchObject({ placement: "active", read: true });
    expect(next.updatedAt).toBe(later.occurredAt);
  });
});

it("does not replace newer mail context with an older snapshot", () => {
  const first = ingestInboxItem(project, { ...message, source: "superhuman", replyActivity: [] });
  const newer = {
    ...message,
    source: "superhuman" as const,
    content: "Newest mail",
    occurredAt: "2026-10-22T12:00:00Z",
    replyActivity: [{ id: "new-mail", occurredAt: "2026-10-22T12:00:00Z", isSelf: false }],
  };
  const current = ingestInboxItem(project, newer, first);
  expect(
    ingestInboxItem(project, { ...message, source: "superhuman", replyActivity: [] }, current),
  ).toBe(current);
});

it("reconciles confirmed uploads by file ID before classifying replayed activity", () => {
  const root = {
    ts: "1793260800.000001",
    author: "Alex",
    content: "Question",
    formattedContent: "Question",
    occurredAt: "2026-10-29T08:00:00Z",
    images: [],
  };
  const thread = {
    formatVersion: 2 as const,
    channelId: "C1",
    ts: root.ts,
    root,
    messages: [],
    latestReplyTs: null,
    replyCount: 0,
    nextCursor: null,
  };
  const original = {
    ...message,
    groupId: `C1:${root.ts}`,
    slackThread: thread,
    replyActivity: [{ id: "old", occurredAt: root.occurredAt, isSelf: false }],
  };
  const first = ingestInboxItem(project, original);
  const pending = {
    ...first,
    state: { ...first.state, read: true, placement: "resolved" as const },
    slackThread: {
      ...thread,
      pendingMessages: [
        {
          ...root,
          ts: "file:F1",
          images: [{ id: "F1", name: "shot.png" }],
          occurredAt: "2026-10-29T08:04:00Z",
        },
      ],
    },
  };
  const native = {
    ...root,
    ts: "1793260920.000001",
    occurredAt: "2026-10-29T08:02:00Z",
    images: [{ id: "F1", name: "shot.png", url: "https://files.slack.com/shot.png" }],
  };
  const echo = {
    ...original,
    id: "echo",
    slackThread: { ...thread, messages: [native], latestReplyTs: native.ts, replyCount: 1 },
    replyActivity: [
      { id: "delayed-old", occurredAt: "2026-10-29T08:01:00Z", isSelf: false },
      { id: `C1:${native.ts}`, occurredAt: native.occurredAt, isSelf: true },
    ],
  };
  const reconciled = ingestInboxItem(project, echo, pending);
  expect(reconciled.state).toEqual(pending.state);
  expect(reconciled.replyCursor?.id).toBe(`C1:${native.ts}`);
  expect(reconciled.slackThread?.pendingMessages ?? []).toEqual([]);
  expect(reconciled.slackThread?.messages.map((m) => m.ts)).toEqual([native.ts]);
  const later = ingestInboxItem(
    project,
    {
      ...echo,
      id: "incoming",
      replyActivity: [{ id: "later", occurredAt: "2026-10-29T08:03:00Z", isSelf: false }],
    },
    reconciled,
  );
  expect(later.state.read).toBe(false);
  expect(later.state.placement).toBe("active");
});

it("upgrades a retained activity's actor classification during normal sync without replaying state transitions", () => {
  const event = { id: "status", occurredAt: message.occurredAt, isSelf: false };
  const before = ingestInboxItem(project, { ...message, replyActivity: [event] });
  const settled = {
    ...before,
    state: { ...before.state, placement: "resolved" as const, read: false },
  };
  const after = ingestInboxItem(
    project,
    { ...message, replyActivity: [{ ...event, isSelf: true, kind: "update" }] },
    settled,
  );
  expect(after.replyCursor).toMatchObject({ isSelf: true, kind: "update" });
  expect(after.state).toEqual(settled.state);
});
