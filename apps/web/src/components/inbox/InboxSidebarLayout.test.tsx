// @vitest-environment jsdom
import { InboxReplyComposer } from "./InboxReplyComposer";
import { openInboxReply, useInboxReplyDrafts } from "./inboxReplyDraft";
import { AsyncResult } from "effect/reactivity";
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  type InboxNotification,
} from "@t3tools/contracts";
import { InboxAnimatedList, InboxRow } from "./InboxSidebarLayout";

const state = vi.hoisted(() => ({
  focus: vi.fn(),
  action: vi.fn(),
  open: vi.fn().mockResolvedValue(undefined),
  refresh: vi.fn(),
  send: vi.fn(),
  deferDetail: false,
  details: new Map<string, InboxNotification>(),
}));
vi.mock("~/state/entities", () => ({
  useServerConfigs: () =>
    new Map([
      [
        "env",
        {
          settings: {
            ...DEFAULT_SERVER_SETTINGS,
            inboxSummaryEnabled: true,
            inboxAgentEnabled: true,
          },
        },
      ],
    ]),
  waitForThreadShell: vi.fn(),
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.send }));
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { refresh: () => {} } }));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("~/state/inbox", () => ({
  inboxEnvironment: {
    mutate: { permissionAtom: () => null },
    reply: { permissionAtom: () => null },
    sources: () => null,
    list: () => null,
    get: (request: unknown) => request,
  },
  readInboxNotification: async (_environmentId: string, _projectId: string, id: string) =>
    state.details.get(id) ?? null,
}));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (request: { input: { id: string } } | null) => ({
    data: !state.deferDetail && request ? (state.details.get(request.input.id) ?? null) : null,
    error: null,
    refresh: state.refresh,
  }),
}));
vi.mock("~/browser/useOpenLink", () => ({ useOpenLink: () => (url: string) => state.open(url) }));
vi.mock("~/localApi", () => ({ readLocalApi: () => ({ shell: { openExternal: state.open } }) }));
vi.mock("./InboxNotificationMetadata", () => ({
  InboxNotificationMetadata: () => <span>Notification header</span>,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  state.details.clear();
  useInboxReplyDrafts.setState({ drafts: {} });
  state.send.mockReset();
  state.deferDetail = false;
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
      replyTarget: { source: "slack", channelId: "C1", threadTs: "1793260800.000001" },
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
const environmentId = EnvironmentId.make("env");
function Rows() {
  const [focused, setFocused] = useState("other");
  return ["closed", "other"].map((id) => {
    const value = { ...notification, id };
    state.details.set(id, value);
    return (
      <InboxRow
        key={id}
        entry={{ environmentId, notification: value }}
        focused={focused === id}
        hints={false}
        pending={false}
        onFocus={() => {
          state.focus(id);
          setFocused(id);
        }}
        onAction={(action) => state.action(id, action)}
      />
    );
  });
}
const row = (id: string) => container.querySelector<HTMLElement>(`[data-inbox-row="env:${id}"]`)!;
it.each([
  ["Agent", { type: "delegate", startAgent: true }],
  ["Agent chat", { type: "delegate", startAgent: false }],
  ["Snooze", "snooze-menu"],
  ["Mark as read", { type: "read", read: true }],
  ["Settle", { type: "resolve", resolved: true }],
  ["Open original", null],
])(
  "runs %s on a collapsed notification without expanding, marking it read through focus, or closing the other row",
  async (label, action) => {
    await act(async () => root.render(<Rows />));
    const button = row("closed").querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    // Native pointer activation focuses the button before dispatching its click.
    await act(async () => button.focus());
    await act(async () => button.click());
    expect(row("closed").getAttribute("aria-expanded")).toBe("false");
    expect(row("other").getAttribute("aria-expanded")).toBe("true");
    expect(state.focus).not.toHaveBeenCalled();
    if (action) expect(state.action).toHaveBeenCalledExactlyOnceWith("closed", action);
    else expect(state.open).toHaveBeenCalledExactlyOnceWith("https://example.test/");
  },
);
it("still expands and selects a row when its body is clicked or the row itself receives keyboard focus", async () => {
  await act(async () => root.render(<Rows />));
  await act(async () => row("closed").querySelector("span")!.click());
  expect(row("closed").getAttribute("aria-expanded")).toBe("true");
  expect(row("other").getAttribute("aria-expanded")).toBe("false");
  await act(async () => row("other").focus());
  expect(row("closed").getAttribute("aria-expanded")).toBe("false");
  expect(row("other").getAttribute("aria-expanded")).toBe("true");
});
it("keeps an already expanded row open when one of its actions is activated", async () => {
  await act(async () => root.render(<Rows />));
  const button = row("other").querySelector<HTMLButtonElement>(
    'button[aria-label="Mark as read"]',
  )!;
  await act(async () => button.focus());
  await act(async () => button.click());
  expect(row("other").getAttribute("aria-expanded")).toBe("true");
  expect(state.focus).not.toHaveBeenCalled();
  expect(state.action).toHaveBeenCalledExactlyOnceWith("other", { type: "read", read: true });
});

it("fades the settled notification out while remaining notifications slide up with chat timing", async () => {
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.parentElement ? [...this.parentElement.children].indexOf(this) * 100 : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(80);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  const animations: { node: HTMLElement; frames: Keyframe[]; options: KeyframeAnimationOptions }[] =
    [];
  const animate = vi.fn(function (
    this: HTMLElement,
    frames: Keyframe[],
    options: KeyframeAnimationOptions,
  ) {
    animations.push({ node: this, frames, options });
    return {
      cancel: vi.fn(),
      addEventListener: vi.fn(),
      effect: { getComputedTiming: () => ({ progress: 0 }) },
      playState: "running",
    };
  });
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: animate });
  const render = (ids: string[]) =>
    act(async () =>
      root.render(
        <InboxAnimatedList>
          {ids.map((id) => (
            <article key={id} data-inbox-row={id}>
              {id}
            </article>
          ))}
        </InboxAnimatedList>,
      ),
    );
  try {
    await render(["settling", "next", "last"]);
    expect(animations).toHaveLength(0);
    await render(["settling", "next", "last"]);
    expect(animations).toHaveLength(0);
    await render(["next", "last"]);
    const next = animations.find((item) => item.node.dataset.inboxRow === "next");
    expect(next?.frames).toEqual([
      { transform: "translateY(100px)" },
      { transform: "translateY(0px)" },
    ]);
    expect(next?.options).toEqual({ duration: 150, easing: "ease-out" });
    expect(animations.find((item) => item.node.dataset.inboxRow === "last")?.frames).toEqual(
      next?.frames,
    );
    const animationCount = animations.length;
    await render(["next", "last"]);
    expect(animations).toHaveLength(animationCount);
    const ghost = container.querySelector<HTMLElement>('[aria-hidden="true"]');
    expect(ghost?.textContent).toBe("settling");
    expect(ghost?.inert).toBe(true);
    expect(ghost?.hasAttribute("data-inbox-row")).toBe(false);
    expect(container.querySelectorAll("[data-inbox-row]")).toHaveLength(2);
  } finally {
    await act(async () => root.unmount());
    root = createRoot(container);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  }
});

it("opens an inline reply using Enter on the focused row", async () => {
  const target = { source: "slack" as const, channelId: "C1", threadTs: "1793260800.000001" };
  state.details.set("other", {
    ...notification,
    id: "other",
    items: notification.items.map((item) => ({ ...item, replyTarget: target })),
  });
  await act(async () => root.render(<Rows />));
  await act(async () => row("other").focus());
  await act(async () =>
    row("other").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(row("other").querySelector('textarea[aria-label="Reply"]')).not.toBeNull();
  expect(state.action).not.toHaveBeenCalled();
});

it("keeps edited draft text through newer suggestions, Escape, and reopening", async () => {
  const n = {
    ...notification,
    analysis: {
      description: "Release",
      summary: "Confirm release",
      suggestions: ["Reply to Alex"],
      replyDraft: "Friday works.",
      precedentIds: [],
      generatedAt: notification.updatedAt,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
    },
  };
  await act(async () => {
    openInboxReply(environmentId, n);
    root.render(<InboxReplyComposer environmentId={environmentId} notification={n} />);
  });
  const input = container.querySelector("textarea")!;
  expect(input.value).toBe("Friday works.");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "Monday instead.",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const newer = { ...n, analysis: { ...n.analysis, replyDraft: "Tuesday works." } };
  await act(async () =>
    root.render(<InboxReplyComposer environmentId={environmentId} notification={newer} />),
  );
  expect(input.value).toBe("Monday instead.");
  await act(async () =>
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(container.querySelector("textarea")).toBeNull();
  await act(async () => openInboxReply(environmentId, newer));
  expect(container.querySelector("textarea")!.value).toBe("Monday instead.");
});

it("Cmd+Enter sends once, disables the pending input, and preserves text after failure", async () => {
  let finish!: (value: unknown) => void;
  state.send.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {
    openInboxReply(environmentId, notification);
    root.render(<InboxReplyComposer environmentId={environmentId} notification={notification} />);
  });
  const input = container.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "Friday works.",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    );
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    );
  });
  expect(state.send).toHaveBeenCalledTimes(1);
  expect(input.disabled).toBe(true);
  const sent = state.send.mock.calls[0]![0].input;
  await act(async () =>
    finish(AsyncResult.success({ ...sent, status: "failed", error: "Reconnect Slack." })),
  );
  expect(input.disabled).toBe(false);
  expect(input.value).toBe("Friday works.");
  expect(container.textContent).toContain("Reconnect Slack.");
  expect(container.textContent).not.toContain("Check result");
  for (const text of ["Monday", "Monday works instead."]) {
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
        input,
        text,
      );
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.disabled).toBe(false);
    expect(input.value).toBe(text);
  }
  expect(container.textContent).not.toContain("Check result");
  await act(async () =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
    ),
  );
  expect(state.send).toHaveBeenCalledTimes(2);
  const retried = state.send.mock.calls[1]![0].input;
  expect(retried.text).toBe("Monday works instead.");
  expect(retried.commandId).not.toBe(sent.commandId);
  await act(async () => finish(AsyncResult.success({ ...retried, status: "sent" })));
  expect(container.querySelector("textarea")).toBeNull();
});

it("loads the full reply draft when Enter beats the row detail query", async () => {
  state.deferDetail = true;
  state.details.set(notification.id, {
    ...notification,
    analysis: {
      description: "Release",
      summary: "Confirm release",
      suggestions: [],
      replyDraft: "The saved message draft.",
      precedentIds: [],
      generatedAt: notification.updatedAt,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
    },
  });
  await act(async () =>
    root.render(
      <InboxRow
        entry={{ environmentId, notification }}
        focused
        hints={false}
        pending={false}
        onFocus={() => {}}
        onAction={() => {}}
      />,
    ),
  );
  const row = container.querySelector("article")!;
  await act(async () =>
    row.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })),
  );
  expect(container.querySelector("textarea")!.value).toBe("The saved message draft.");
});
