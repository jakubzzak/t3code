import { expect, it } from "vite-plus/test";
import { ProjectId, ThreadId, ProviderInstanceId } from "@t3tools/contracts";
import { ingestInboxItem } from "./inboxState.ts";
import { readableNotification } from "./notificationContent.ts";
import { inboxContext } from "./notificationContext.ts";

const notification = ingestInboxItem(ProjectId.make("project"), {
  id: "email",
  source: "superhuman",
  connectionId: "work@example.test",
  groupId: "thread",
  title: "Report",
  author: "Alex",
  location: "Important",
  url: "https://mail.superhuman.com/thread",
  occurredAt: "2026-10-22T10:00:00Z",
  content:
    '<div style="display:none">' +
    "tracking ".repeat(1500) +
    "</div><p>Please send the PHP security report by EOD.</p>",
});
it("cleans legacy cached email, invalidates its summary, and retains triage, read state and chat links", () => {
  const stored = {
    ...notification,
    state: {
      ...notification.state,
      read: true,
      placement: "delegated" as const,
      threadId: ThreadId.make("chat"),
    },
    analysis: {
      description: "Important email",
      summary: "Marked unread",
      suggestions: [],
      precedentIds: [],
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
      generatedAt: notification.updatedAt,
    },
  };
  const clean = readableNotification(stored);
  expect(clean.items[0]?.content).toBe("Please send the PHP security report by EOD.");
  expect(clean.state).toEqual(stored.state);
  expect(clean.analysis).toBeNull();
  expect(clean.analysisVersion).toBe(stored.analysisVersion + 1);
  expect(readableNotification(clean)).toBe(clean);
});
it("cleans email before bounding model/delegation context, preserving the request rather than tracking markup", () => {
  const context = JSON.parse(inboxContext(notification));
  expect(context.items[0].content).toBe("Please send the PHP security report by EOD.");
  expect(context.items[0].truncated).toBe(false);
  expect(inboxContext(notification)).not.toContain("tracking");
});
it("tells the agent how much Slack history is absent from a partial thread", () => {
  const message = {
    ts: "1792620000",
    author: "Alex",
    content: "Review the release",
    formattedContent: "Review the release",
    occurredAt: "2026-10-22T10:00:00Z",
  };
  const context = JSON.parse(
    inboxContext({
      ...notification,
      slackThread: {
        channelId: "C1",
        ts: message.ts,
        root: message,
        latestReplyTs: "1792620002",
        replyCount: 20,
        messages: [
          { ...message, ts: "1792620001" },
          { ...message, ts: "1792620002" },
        ],
        nextCursor: "older",
      },
    }),
  );
  expect(context.slackThread.messages).toHaveLength(2);
  expect(context.slackThread.omittedEarlierMessages).toBe(18);
});
it("preserves literal HTML examples already marked as plain text and leaves Linear source bodies untouched", () => {
  const text = {
    ...notification,
    items: [
      {
        ...notification.items[0]!,
        content: "Discuss <b>bold</b> in the parser.",
        contentFormat: "text" as const,
      },
    ],
  };
  expect(readableNotification(text)).toBe(text);
  const linear = {
    ...notification,
    source: "linear" as const,
    items: [{ ...notification.items[0]!, source: "linear" as const }],
  };
  expect(readableNotification(linear)).toBe(linear);
});

it("repairs cached Slack links and tags once without changing read, triage or linked chat state", () => {
  const stored = {
    ...notification,
    items: [
      {
        ...notification.items[0]!,
        source: "slack" as const,
        content:
          "<@U123|Alex> review <https://example.com|the report> with <!subteam^S123|@support>.",
      },
    ],
  };
  const clean = readableNotification(stored);
  expect(clean.items[0]?.content).toContain("@Alex");
  expect(clean.items[0]?.formattedContent).toContain("[the report](<https://example.com/>)");
  expect(clean.items[0]?.content).toContain("@support");
  expect(clean.state).toBe(stored.state);
  expect(readableNotification(clean)).toBe(clean);
});
