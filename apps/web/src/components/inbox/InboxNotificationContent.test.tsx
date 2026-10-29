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
import { InboxNotificationMetadata } from "./InboxNotificationMetadata";
import { slackText, slackMentions } from "@t3tools/shared/slackText";
const state = vi.hoisted(() => ({
  open: vi.fn(),
  preview: vi.fn(),
  preference: "system",
  toast: vi.fn(),
}));
vi.mock("~/assets/assetUrls", () => ({
  useAssetUrlState: () => ({ _tag: "Success", url: "/fixture-image.png" }),
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (select: (settings: { timestampFormat: "locale" }) => unknown) =>
    select({ timestampFormat: "locale" }),
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

it.each(["slack", "superhuman"] as const)(
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
it.each(["slack", "superhuman"] as const)(
  "renders plain %s quotations without treating the rest of the body as Markdown",
  async (source) => {
    await act(async () =>
      root.render(
        <InboxSourceContent
          threadRef={threadRef}
          notification={{
            ...notification,
            source,
            items: [
              {
                ...notification.items[0]!,
                source,
                content:
                  "Before\n> Review https://example.test/report\n> Keep this context\nReply *literally*, a > b.\n<script>unsafe()</script>",
              },
            ],
          }}
        />,
      ),
    );
    const quotes = container.querySelectorAll("blockquote");
    expect(quotes).toHaveLength(1);
    expect(quotes[0]!.textContent).toBe("Review example.test\nKeep this context");
    expect(quotes[0]!.querySelector("a")?.getAttribute("href")).toBe("https://example.test/report");
    expect(quotes[0]!.textContent).not.toContain("Reply");
    expect(container.textContent).toContain("Reply *literally*, a > b.");
    expect(container.querySelector("script, em")).toBeNull();
  },
);

it("renders escaped Slack quotes in both the original and reply without quoting replies or code", async () => {
  const message = (ts: string, content: string) => ({
    ts,
    occurredAt: notification.updatedAt,
    author: "Joel",
    content,
    formattedContent: slackText(content),
  });
  await act(async () =>
    root.render(
      <InboxSourceContent
        notification={{
          ...notification,
          slackThread: {
            channelId: "C1",
            ts: "1",
            nextCursor: null,
            replyCount: 1,
            latestReplyTs: "2",
            root: message("1", "Before\n&gt; Original quote\nOriginal response"),
            messages: [
              message(
                "2",
                "> Review <https://example.test/report|the report>\n> Second quoted line\nWe could add a label.\n```\n> code stays literal\n```\nInline `> literal` and a > b.",
              ),
            ],
          },
        }}
      />,
    ),
  );
  const quotes = [...container.querySelectorAll("blockquote")];
  expect(quotes).toHaveLength(2);
  expect(quotes[0]!.textContent).toContain("Original quote");
  expect(quotes[0]!.textContent).not.toContain("Original response");
  expect(quotes[1]!.textContent).toContain("Review the report");
  expect(quotes[1]!.textContent).toContain("Second quoted line");
  expect(quotes[1]!.textContent).not.toContain("We could");
  expect(quotes[1]!.querySelector("a")?.getAttribute("href")).toBe("https://example.test/report");
  expect(container.querySelector("pre code")?.textContent).toBe("> code stays literal\n");
  expect(container.textContent).toContain("Inline > literal and a > b.");
});

it("renders Markdown quotations in Linear issue descriptions and comments", async () => {
  await act(async () =>
    root.render(
      <InboxSourceContent
        notification={{
          ...notification,
          source: "linear",
          linearIssue: {
            id: "issue",
            title: "Review release",
            description: "> **Requested change**\n\nDescription response",
            commentCount: 1,
            commentsComplete: true,
            comments: [
              {
                id: "comment",
                author: "Joel",
                occurredAt: notification.updatedAt,
                body: "> Can we separate issues?\n\nWe could add a label.\n\n```\n> literal code\n```",
              },
            ],
          },
        }}
      />,
    ),
  );
  const quotes = [...container.querySelectorAll("blockquote")];
  expect(quotes).toHaveLength(2);
  expect(quotes[0]!.querySelector("strong")?.textContent).toBe("Requested change");
  expect(quotes[0]!.textContent).not.toContain("Description response");
  expect(quotes[1]!.textContent).toContain("Can we separate issues?");
  expect(quotes[1]!.textContent).not.toContain("We could");
  expect(container.querySelector("pre code")?.textContent).toBe("> literal code\n");
});
it("links URLs in AI summaries, suggested next steps, and raw notification titles", async () => {
  await act(async () =>
    root.render(
      <InboxSummary
        threadRef={threadRef}
        enabled
        expanded
        suggestionsEnabled
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
  const callout = container.querySelector('section[aria-label="Suggestion"]');
  expect(callout?.textContent).toContain("Check docs.example.com");
  expect(callout?.querySelector("button")).toBeNull();
  await act(async () =>
    root.render(
      <InboxSummary
        enabled
        expanded
        suggestionsEnabled={false}
        notification={{
          ...notification,
          analysis: {
            summary: "Review report",
            suggestions: ["Check report"],
            description: "Review",
            precedentIds: [],
            modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
            generatedAt: "2026-10-22T10:00:00Z",
          },
        }}
      />,
    ),
  );
  expect(container.textContent).toContain("Review report");
  expect(
    container
      .querySelector('section[aria-label="Suggestion"]')
      ?.closest("[aria-hidden]")
      ?.getAttribute("aria-hidden"),
  ).toBe("true");
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

it("renders cached Linear issue/comment Markdown with lists, code, tables, and labeled attachments", async () => {
  const content = [
    "## Review",
    "",
    "**Ready** and _verified_.",
    "",
    "[Review PR](https://github.com/example/project/pull/608)",
    "",
    "1. Verify staging",
    "2. Publish",
    "",
    "- [x] Tests passed",
    "- [ ] Ship",
    "",
    "> Keep the existing behavior.",
    "",
    "```ts",
    "const url = 'https://example.com/code';",
    "```",
    "",
    "| Check | Result |",
    "| --- | --- |",
    "| Tests | Pass |",
    "",
    "![Screenshot](https://uploads.linear.app/example/screenshot.png)",
  ].join("\n");
  await act(async () =>
    root.render(
      <InboxSourceContent
        threadRef={threadRef}
        notification={{
          ...notification,
          source: "linear",
          items: [{ ...notification.items[0]!, source: "linear", contentFormat: "text", content }],
        }}
      />,
    ),
  );
  expect(container.querySelector("h2")?.textContent).toBe("Review");
  expect(container.querySelector("strong")?.textContent).toBe("Ready");
  expect(container.querySelector("em")?.textContent).toBe("verified");
  expect(container.querySelectorAll("ol > li")).toHaveLength(2);
  const tasks = [...container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
  expect(tasks.map((task) => [task.checked, task.disabled])).toEqual([
    [true, true],
    [false, true],
  ]);
  expect(container.querySelector("blockquote")?.textContent).toContain(
    "Keep the existing behavior.",
  );
  expect(container.querySelector("pre code")?.textContent).toContain("https://example.com/code");
  expect(container.querySelector("pre a")).toBeNull();
  expect(container.querySelector("table td")?.textContent).toBe("Tests");
  expect(
    [...container.querySelectorAll("a")].map((link) => [
      link.textContent,
      link.getAttribute("href"),
    ]),
  ).toEqual([
    ["Review PR", "https://github.com/example/project/pull/608"],
    ["Screenshot", "https://uploads.linear.app/example/screenshot.png"],
  ]);
  expect(container.querySelector("img")).toBeNull();
  await act(async () => container.querySelector("a")!.click());
  expect(state.open).toHaveBeenCalledExactlyOnceWith("https://github.com/example/project/pull/608");
});
it("keeps Linear Markdown HTML and unsafe destinations inert", async () => {
  await act(async () =>
    root.render(
      <InboxSourceContent
        notification={{
          ...notification,
          source: "linear",
          items: [
            {
              ...notification.items[0]!,
              source: "linear",
              content:
                '[Unsafe](javascript:alert) ![Unsafe image](javascript:alert) <script>alert(1)</script>\n\n<iframe src="https://example.com"></iframe>',
            },
          ],
        }}
      />,
    ),
  );
  expect(container.querySelector("a, img, script, iframe")).toBeNull();
  expect(container.textContent).toContain("Unsafe");
  expect(state.open).not.toHaveBeenCalled();
});

it("shows original and only the latest Slack reply until cached history is expanded", async () => {
  const message = (ts: string, author: string, content: string) => ({
    ts,
    author,
    content,
    formattedContent: content,
    occurredAt: "2026-10-22T10:00:00Z",
  });
  const slackThread = {
    channelId: "C1",
    ts: "1",
    root: message("1", "Alex", "Original request"),
    latestReplyTs: "4",
    replyCount: 3,
    messages: [
      message("2", "You", "First reply"),
      message("3", "Alex", "Second reply"),
      message("4", "You", "Last reply\nSecond line"),
    ],
    nextCursor: null,
  };
  const load = vi.fn();
  await act(async () =>
    root.render(
      <InboxSourceContent notification={{ ...notification, slackThread }} onLoadPrevious={load} />,
    ),
  );
  expect(container.textContent).toContain("Original request");
  expect(container.textContent).toContain("Last reply");
  expect(container.textContent).not.toContain("First reply");
  const button = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Show all"),
  );
  expect(button).toBeDefined();
  await act(async () => button!.click());
  expect(container.textContent).toContain("First reply");
  expect(button!.textContent).toContain("Latest only");
  expect(load).not.toHaveBeenCalled();
  expect(
    [...container.querySelectorAll("[data-slack-reply]")].map((row) =>
      row.getAttribute("data-slack-reply"),
    ),
  ).toEqual(["2", "3", "4"]);
  await act(async () => button!.click());
  expect(button!.textContent).toContain("Show all");
  expect(container.textContent).not.toContain("First reply");
  expect(container.textContent).toContain("Last reply");
});

it("keeps the latest reply visible on history failure, then loads missing comments once on retry", async () => {
  const msg = (ts: string, content: string) => ({
    ts,
    author: "Alex",
    content,
    formattedContent: content,
    occurredAt: "2026-10-22T10:00:00Z",
  });
  const thread = {
    channelId: "C1",
    ts: "1",
    root: msg("1", "Original"),
    latestReplyTs: "4",
    replyCount: 3,
    messages: [msg("4", "Last reply")],
    nextCursor: "missing",
  };
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("Slack rate limited. Try again."))
    .mockResolvedValueOnce({
      ...thread,
      messages: [msg("2", "Earlier"), msg("3", "Middle"), msg("4", "Last reply")],
      nextCursor: null,
    });
  await act(async () =>
    root.render(
      <InboxSourceContent
        notification={{ ...notification, slackThread: thread }}
        onLoadPrevious={load}
      />,
    ),
  );
  const button = () => container.querySelector<HTMLButtonElement>("button[aria-expanded]")!;
  await act(async () => button().click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Slack rate limited");
  expect(container.textContent).toContain("Last reply");
  await act(async () => button().click());
  expect(container.textContent).toContain("Earlier");
  expect(container.textContent).toContain("Middle");
  await act(async () => button().click());
  await act(async () => button().click());
  expect(load).toHaveBeenCalledTimes(2);
});

it("renders solid personal/group mention tags only for native Slack references, in previews and originals", async () => {
  const names = {
    viewerUserId: "UME",
    users: { UME: "Jakub", UOTHER: "Alex" },
    groups: { SMINE: "checkout-review", SOTHER: "design" },
    memberGroupIds: ["SMINE"],
  };
  const raw = "<@UME> <@UOTHER> <!subteam^SMINE> <!subteam^SOTHER> @Jakub `<!subteam^SMINE>`";
  const item = {
    ...notification.items[0]!,
    formattedTitle: slackText(raw, names, "rich"),
    formattedContent: slackText(raw, names, "rich"),
    slackMentions: slackMentions(raw, names),
  };
  for (const element of [
    <InboxSummary
      key="summary"
      notification={{ ...notification, items: [item] }}
      enabled={false}
    />,
    <InboxSourceContent key="source" notification={{ ...notification, items: [item] }} />,
  ]) {
    await act(async () => root.render(element));
    const tags = [...container.querySelectorAll<HTMLElement>("[data-slack-mention]")];
    expect(tags.map((tag) => [tag.dataset.slackMention, tag.dataset.personal])).toEqual([
      ["user:UME", "true"],
      ["user:UOTHER", "false"],
      ["group:SMINE", "true"],
      ["group:SOTHER", "false"],
    ]);
    expect(tags.every((tag) => tag.querySelector("svg") !== null)).toBe(true);
    expect(container.querySelector("code")?.textContent).toBe("<!subteam^SMINE>");
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.textContent).toContain(" @Jakub ");
  }
  expect(state.open).not.toHaveBeenCalled();
});

it("uses the same today-based date rule for notification headers and thread replies", async () => {
  const date = (year: number, day: number, hour: number) =>
    new Date(year, 9, day, hour, 52).toISOString();
  const message = (ts: string, occurredAt: string) => ({
    ts,
    occurredAt,
    author: "Alex",
    content: "Review",
    formattedContent: "Review",
  });
  const currentYear = new Date().getFullYear();
  const parentYear = currentYear - 1;
  const parent = date(parentYear, 22, 10);
  const item = {
    ...notification,
    items: [{ ...notification.items[0]!, occurredAt: parent }],
    slackThread: {
      channelId: "C1",
      ts: "1",
      root: message("1", date(parentYear, 20, 10)),
      latestReplyTs: "3",
      replyCount: 2,
      nextCursor: null,
      messages: [message("2", date(parentYear, 21, 14)), message("3", date(parentYear, 22, 14))],
    },
  };
  await act(async () =>
    root.render(
      <>
        <InboxNotificationMetadata notification={item} />
        <InboxSourceContent notification={item} />
      </>,
    ),
  );
  const times = () => [...container.querySelectorAll("time")];
  expect(times().map((time) => time.textContent)).toEqual([
    `10:52 · 22 Oct ${parentYear}`,
    `14:52 · 22 Oct ${parentYear}`,
  ]);
  expect(times()[1]!.getAttribute("aria-label")).toBe(`14:52 · 22 Oct ${parentYear}`);
  await act(async () =>
    container.querySelector<HTMLButtonElement>("button[aria-expanded]")!.click(),
  );
  expect(times().map((time) => time.textContent)).toEqual([
    `10:52 · 22 Oct ${parentYear}`,
    `14:52 · 21 Oct ${parentYear}`,
    `14:52 · 22 Oct ${parentYear}`,
  ]);
});

it("separates a Linear issue description from deduplicated comments and shows only the latest initially", async () => {
  const comments = [
    {
      id: "first",
      author: "Maya",
      body: "First unique comment",
      occurredAt: "2026-10-22T12:00:00Z",
    },
    {
      id: "latest",
      author: "Alex",
      body: "Latest **comment**",
      occurredAt: "2026-10-22T13:00:00Z",
    },
  ];
  const issue = {
    id: "issue",
    title: "Review release",
    description: "Description shown once",
    comments,
    commentCount: 12,
    commentsComplete: false,
  };
  const n = {
    ...notification,
    source: "linear" as const,
    groupId: "issue",
    items: [
      {
        ...notification.items[0]!,
        id: "n1",
        source: "linear" as const,
        content: "Repeated flattened text",
        linearIssue: issue,
      },
      {
        ...notification.items[0]!,
        id: "n2",
        source: "linear" as const,
        content: "Repeated flattened text",
        linearIssue: issue,
      },
    ],
  };
  const load = vi.fn().mockResolvedValue({ ...issue, commentsComplete: true });
  await act(async () => root.render(<InboxSourceContent notification={n} onLoadPrevious={load} />));
  expect(container.textContent).toContain("Issue description");
  expect(container.querySelector('[aria-label="Comments"]')?.textContent).toContain("Comments· 12");
  expect(container.textContent?.match(/Description shown once/g)).toHaveLength(1);
  expect(container.textContent).not.toContain("Repeated flattened text");
  expect(container.textContent).not.toContain("First unique comment");
  expect(container.querySelector('[aria-label="Comments"] strong')?.textContent).toBe("comment");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Show all issue comments"]')!
      .click(),
  );
  expect(container.textContent?.match(/First unique comment/g)).toHaveLength(1);
  expect(container.textContent?.match(/Latest comment/g)).toHaveLength(1);
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Show latest comment only"]')!
      .click(),
  );
  expect(container.textContent).not.toContain("First unique comment");
  await act(async () =>
    container
      .querySelector<HTMLButtonElement>('button[aria-label="Show all issue comments"]')!
      .click(),
  );
  expect(load).toHaveBeenCalledTimes(1);
});

it("keeps Linear content on a failed history request and retries without losing it", async () => {
  const comment = {
    id: "c",
    body: "Latest comment stays visible",
    author: "Maya",
    occurredAt: "2026-10-22T10:00:00Z",
  };
  const issue = {
    id: "issue",
    title: "Review",
    description: "Issue remains visible",
    comments: [comment],
    commentsComplete: false,
  };
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("Connection offline"))
    .mockResolvedValueOnce({ ...issue, commentsComplete: true });
  await act(async () =>
    root.render(
      <InboxSourceContent
        notification={{ ...notification, source: "linear", linearIssue: issue }}
        onLoadPrevious={load}
      />,
    ),
  );
  const button = () =>
    container.querySelector<HTMLButtonElement>('button[aria-label="Show all issue comments"]')!;
  await act(async () => button().click());
  expect(container.querySelector('[role="alert"]')?.textContent).toContain("Connection offline");
  expect(container.textContent).toContain("Issue remains visible");
  expect(container.textContent).toContain("Latest comment stays visible");
  await act(async () => button().click());
  expect(load).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
});

it("shows a bold email subject and body without the redundant envelope or Original message introduction", async () => {
  const content =
    "sam@example.test · 2026-10-20T19:26:59Z\nHello team,\n\nReview https://meet.example.test/review.\n\nFrom: the product team, this is a request for feedback.\n\nRoadmap · 2026-11-01";
  await act(async () =>
    root.render(
      <InboxSourceContent
        notification={{
          ...notification,
          source: "superhuman",
          items: [
            {
              ...notification.items[0]!,
              source: "superhuman",
              author: "sam@example.test",
              title: "October investor update",
              content,
            },
          ],
        }}
      />,
    ),
  );
  expect(container.querySelector("strong")?.textContent).toBe("October investor update");
  expect(container.textContent).not.toContain("Original message");
  expect(container.textContent).not.toContain("sam@example.test · 2026");
  expect(container.textContent).toContain("Hello team,");
  expect(container.textContent).toContain(
    "From: the product team, this is a request for feedback.",
  );
  expect(container.textContent).toContain("Roadmap · 2026-11-01");
  expect(container.querySelector("a")?.textContent).toBe("meet.example.test");
});

it("omits explicit legacy Email/From/Timestamp (UTC) envelope headers while preserving the greeting", async () => {
  await act(async () =>
    root.render(
      <InboxSourceContent
        notification={{
          ...notification,
          source: "superhuman",
          items: [
            {
              ...notification.items[0]!,
              source: "superhuman",
              title: "Review",
              content:
                "Email\nFrom: Sam <sam@example.test>\nTimestamp (UTC): 2026-10-20T19:26:59Z\n\nHello team,\nPlease review the report.",
            },
          ],
        }}
      />,
    ),
  );
  expect(container.textContent).not.toContain("Timestamp (UTC)");
  expect(container.textContent).not.toContain("From: Sam");
  expect(container.textContent).toContain("Hello team,");
});

it("shows image-only Slack originals and replies through environment assets, with an unavailable-image fallback", async () => {
  const message = {
    ts: "1700000000",
    author: "Alex",
    content: "",
    formattedContent: "",
    occurredAt: notification.updatedAt,
    images: [{ id: "F1", name: "Original screenshot", url: "https://files.slack.com/private.png" }],
  };
  await act(async () =>
    root.render(
      <InboxSourceContent
        environmentId={threadRef.environmentId}
        notification={{
          ...notification,
          slackThread: {
            formatVersion: 2,
            channelId: "C1",
            ts: message.ts,
            root: message,
            latestReplyTs: "1700000001",
            replyCount: 1,
            nextCursor: null,
            messages: [
              {
                ...message,
                ts: "1700000001",
                images: [
                  { id: "F2", name: "Reply screenshot", url: "https://files.slack.com/reply.png" },
                ],
              },
            ],
          },
        }}
      />,
    ),
  );
  const images = [...container.querySelectorAll("img")];
  expect(images.map((image) => image.alt)).toEqual(["Original screenshot", "Reply screenshot"]);
  expect(images.every((image) => image.getAttribute("src") === "/fixture-image.png")).toBe(true);
  await act(async () => images[1]!.dispatchEvent(new Event("error")));
  expect(container.textContent).toContain("Image unavailable: Reply screenshot");
  expect(container.querySelector('img[alt="Original screenshot"]')).not.toBeNull();
});

it("shows a confirmed image while its Slack preview is pending, then replaces it with native history", async () => {
  const message = {
    ts: "1793260800.000001",
    author: "Alex",
    content: "",
    formattedContent: "",
    occurredAt: notification.updatedAt,
    images: [],
  };
  const pending = { ...message, ts: "file:F1", images: [{ id: "F1", name: "Sent screenshot" }] };
  const thread = {
    formatVersion: 2 as const,
    channelId: "C1",
    ts: message.ts,
    root: message,
    latestReplyTs: null,
    replyCount: 0,
    nextCursor: null,
    messages: [],
    pendingMessages: [pending],
  };
  await act(async () =>
    root.render(
      <InboxSourceContent
        environmentId={threadRef.environmentId}
        notification={{ ...notification, slackThread: thread }}
      />,
    ),
  );
  expect(container.textContent).toContain("Sent image: Sent screenshot. Preview pending.");
  expect(container.textContent).toContain("1 reply");
  const native = {
    ...pending,
    ts: "1793260920.000001",
    images: [{ id: "F1", name: "Sent screenshot", url: "https://files.slack.com/shot.png" }],
  };
  await act(async () =>
    root.render(
      <InboxSourceContent
        environmentId={threadRef.environmentId}
        notification={{
          ...notification,
          slackThread: {
            ...thread,
            pendingMessages: [],
            messages: [native],
            latestReplyTs: native.ts,
            replyCount: 1,
          },
        }}
      />,
    ),
  );
  expect(container.textContent).not.toContain("Preview pending");
  expect(container.querySelectorAll("[data-slack-reply]")).toHaveLength(1);
  expect(container.querySelector('img[alt="Sent screenshot"]')).not.toBeNull();
});
