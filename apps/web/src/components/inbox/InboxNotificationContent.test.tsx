// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import {
  EnvironmentId,
  ThreadId,
  ProjectId,
  ProviderInstanceId,
  type InboxNotification,
} from "@t3tools/contracts";
import {
  InboxOpenOriginalAction,
  InboxSourceContent,
  InboxSummary,
} from "./InboxNotificationContent";
import { slackText } from "@t3tools/shared/slackText";
const state = vi.hoisted(() => ({
  open: vi.fn(),
  preview: vi.fn(),
  preference: "system",
  toast: vi.fn(),
}));
vi.mock("~/hooks/useSettings", () => ({
  ensureClientSettingsHydrated: async () => {},
  getClientSettings: () => ({ browserLinkTarget: state.preference }),
}));
vi.mock("~/browser/previewRuntime", () => ({ isPreviewAvailableFor: () => true }));
vi.mock("~/state/session", () => ({ readEnvironmentScope: () => true }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.preview }));
vi.mock("~/browser/openFileInPreview", () => ({
  openUrlInPreview: (...args: unknown[]) => state.preview(...args),
  BrowserSettingsReadError: class extends Error {},
}));
vi.mock("~/browserHistoryStore", () => ({ recordVisitForThread: vi.fn() }));
vi.mock("../ui/toast", () => ({ toastManager: { add: state.toast } }));
const threadRef = { environmentId: EnvironmentId.make("env"), threadId: ThreadId.make("chat") };
beforeEach(() => {
  state.preference = "system";
  state.open.mockResolvedValue(undefined);
  state.preview.mockResolvedValue({ _tag: "Success", value: undefined });
});
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
      url: "https://example.test/",
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

it.each(["app", "system"])(
  "uses the saved %s link target for Slack content and the source icon",
  async (preference) => {
    state.preference = preference;
    await act(async () =>
      root.render(
        <>
          <InboxSourceContent
            threadRef={threadRef}
            notification={{
              ...notification,
              items: [
                {
                  ...notification.items[0]!,
                  formattedContent: "[Report](https://example.test/report)",
                },
              ],
            }}
          />
          <InboxOpenOriginalAction threadRef={threadRef} notification={notification} />
        </>,
      ),
    );
    await act(async () => container.querySelector<HTMLAnchorElement>("a")!.click());
    await act(async () =>
      container.querySelector<HTMLButtonElement>('button[aria-label="Open original"]')!.click(),
    );
    if (preference === "app") {
      expect(state.preview).toHaveBeenCalledTimes(2);
      expect(state.preview).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ threadRef, url: "https://example.test/report" }),
      );
      expect(state.preview).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ threadRef, url: "https://example.test/" }),
      );
      expect(state.open).not.toHaveBeenCalled();
    } else {
      expect(state.open.mock.calls.map(([url]) => url)).toEqual([
        "https://example.test/report",
        "https://example.test/",
      ]);
      expect(state.preview).not.toHaveBeenCalled();
    }
  },
);

it("preserves modifier-click escape to the system browser with in-app links enabled", async () => {
  state.preference = "app";
  await act(async () =>
    root.render(
      <InboxSourceContent
        threadRef={threadRef}
        notification={{
          ...notification,
          items: [
            {
              ...notification.items[0]!,
              formattedContent: "[Report](https://example.test/report)",
            },
          ],
        }}
      />,
    ),
  );
  await act(async () =>
    container
      .querySelector("a")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true })),
  );
  expect(state.open).toHaveBeenCalledExactlyOnceWith("https://example.test/report");
  expect(state.preview).not.toHaveBeenCalled();
});

it.each(["slack", "linear", "superhuman"] as const)(
  "links raw %s notification URLs with short host labels and full destinations",
  async (source) => {
    const text =
      "Review https://github.com/example/project/pull/608.\nThen https://backstage.example.com/requests/42?view=all#notes and www.example.com/help.\nKeep *literal* text.";
    await act(async () =>
      root.render(
        <InboxSourceContent
          threadRef={threadRef}
          notification={{
            ...notification,
            source,
            items: [{ ...notification.items[0]!, source, content: text }],
          }}
        />,
      ),
    );
    const links = [...container.querySelectorAll<HTMLAnchorElement>("a")];
    expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["github.com", "https://github.com/example/project/pull/608"],
      ["backstage.example.com", "https://backstage.example.com/requests/42?view=all#notes"],
      ["example.com", "https://www.example.com/help"],
    ]);
    expect(container.textContent).toContain(
      "github.com.\nThen backstage.example.com and example.com.\nKeep *literal* text.",
    );
    await act(async () => links[1]!.click());
    expect(state.open).toHaveBeenCalledExactlyOnceWith(
      "https://backstage.example.com/requests/42?view=all#notes",
    );
  },
);
it("shortens bare Markdown URLs but leaves already labeled links and code unchanged", async () => {
  await act(async () =>
    root.render(
      <InboxSourceContent
        threadRef={threadRef}
        notification={{
          ...notification,
          items: [
            {
              ...notification.items[0]!,
              formattedContent:
                "https://github.com/example/project/pull/608 and [This client](https://backstage.example.com/requests/42). `https://example.com/code`",
            },
          ],
        }}
      />,
    ),
  );
  const links = [...container.querySelectorAll("a")];
  expect(links.map((link) => link.textContent)).toEqual(["github.com", "This client"]);
  expect(container.querySelector("code")?.textContent).toBe("https://example.com/code");
  expect(
    links.every(
      (link) => link.classList.contains("underline") && link.classList.contains("text-primary"),
    ),
  ).toBe(true);
});
it("links URLs in AI summaries, suggested next steps, and raw notification titles", async () => {
  await act(async () =>
    root.render(
      <InboxSummary
        threadRef={threadRef}
        enabled
        expanded
        notification={{
          ...notification,
          analysis: {
            summary: "Review https://github.com/example/project/pull/608",
            suggestions: ["Check https://docs.example.com/guide"],
            description: "Review",
            precedentIds: [],
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
            generatedAt: "2026-10-22T10:00:00Z",
          },
        }}
      />,
    ),
  );
  expect([...container.querySelectorAll("a")].map((link) => link.textContent)).toEqual([
    "github.com",
    "docs.example.com",
  ]);
  await act(async () =>
    root.render(
      <InboxSummary
        threadRef={threadRef}
        enabled={false}
        notification={{
          ...notification,
          items: [{ ...notification.items[0]!, title: "Review https://example.com/report" }],
        }}
      />,
    ),
  );
  expect(container.querySelector("a")?.textContent).toBe("example.com");
});
