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
it("preserves literal HTML examples already marked as plain text and leaves other source bodies untouched", () => {
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
  const slack = {
    ...notification,
    source: "slack" as const,
    items: [{ ...notification.items[0]!, source: "slack" as const }],
  };
  expect(readableNotification(slack)).toBe(slack);
});
