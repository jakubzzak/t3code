// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { ProjectId, type InboxNotification } from "@t3tools/contracts";
import { InboxSourceContent, InboxSummary } from "./InboxNotificationContent";
import { slackText } from "@t3tools/shared/slackText";
const state = vi.hoisted(() => ({ open: vi.fn() }));
vi.mock("~/localApi", () => ({ readLocalApi: () => ({ shell: { openExternal: state.open } }) }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.clearAllMocks();
});
const notification: InboxNotification = {
  id: "fixture",
  projectId: ProjectId.make("one"),
  source: "slack",
  connectionId: "team",
  groupId: "thread",
  revision: 0,
  state: { read: false, placement: "active", snoozedUntil: null, threadId: null },
  items: [
    {
      id: "m",
      source: "slack",
      connectionId: "team",
      groupId: "thread",
      location: "#support",
      title: "Review report",
      author: "Alex",
      content: "",
      contentFormat: "text",
      url: "https://example.test",
      occurredAt: "2026-10-22T10:00:00Z",
    },
  ],
  analysis: null,
  processingError: "AI summary not available",
  analysisVersion: 0,
  analysisAttempts: 3,
  analysisRetryAt: null,
  agentStatus: "idle",
  agentError: null,
  agentAttempt: 0,
  agentIntent: null,
  linkedChatSettled: false,
  updatedAt: "2026-10-22T10:00:00Z",
  confirmedOutcome: null,
};
it("opens a labeled Slack link through the normal shell and renders people/groups without raw tokens or remote images", async () => {
  state.open.mockResolvedValue(undefined);
  const content = slackText(
    '<@U123> and <!subteam^S123> review <https://example.com/report|the report>. *Urgent* <img src="https://tracker.example/pixel">',
    { users: { U123: "Alex" }, groups: { S123: "support" } },
  );
  await act(async () =>
    root.render(
      <InboxSourceContent
        notification={{
          ...notification,
          items: [{ ...notification.items[0]!, formattedContent: content }],
        }}
      />,
    ),
  );
  expect(container.textContent).toContain("@Alex and @support review the report.");
  expect(container.textContent).not.toContain("<@U123>");
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("strong")?.textContent).toBe("Urgent");
  const link = container.querySelector<HTMLAnchorElement>("a")!;
  expect(link.textContent).toBe("the report");
  await act(async () => link.click());
  expect(state.open).toHaveBeenCalledExactlyOnceWith("https://example.com/report");
});
it("never renders a pending label, and shows the terminal fallback without a retry control", async () => {
  for (const processingError of [null, "Provider error details"]) {
    await act(async () =>
      root.render(<InboxSummary notification={{ ...notification, processingError }} enabled />),
    );
    expect(container.textContent).toContain("AI summary not available");
    expect(container.textContent).not.toMatch(/pending|Provider error|Retry summary/i);
  }
});
