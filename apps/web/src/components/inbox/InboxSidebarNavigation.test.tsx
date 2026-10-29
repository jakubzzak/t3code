// @vitest-environment jsdom
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  ThreadId,
  type InboxNotification,
} from "@t3tools/contracts";
import { InboxSidebarLayout } from "./InboxSidebarLayout";
import { installSectionNavigation } from "~/sectionNavigation";
import { useInboxNavigation } from "./inboxNavigation";
import { useComposerDraftStore } from "~/composerDraftStore";
import { subscribeSnapShotComposerFocus } from "~/lib/desktopSnapShot";
import { dismissContextMenu } from "~/contextMenuFallback";

const state = vi.hoisted(() => ({
  items: [] as InboxNotification[],
  navigate: vi.fn(),
  wait: vi.fn(),
  mutate: vi.fn(),
  read: vi.fn(),
  summary: false,
  resolutions: false,
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ navigate: state.navigate }) }));
vi.mock("~/state/entities", () => ({
  useServerConfigs: () =>
    new Map([
      [
        "env",
        {
          settings: {
            ...DEFAULT_SERVER_SETTINGS,
            inboxEnabled: true,
            inboxAgentEnabled: true,
            inboxSummaryEnabled: state.summary,
            inboxPreResolution: state.resolutions,
          },
        },
      ],
    ]),
  waitForThreadShell: (...args: unknown[]) => state.wait(...args),
}));
vi.mock("../settings/useSettingsProjectGroups", () => ({ useSettingsProjectGroups: () => [] }));
vi.mock("@effect/atom-react", async () => {
  const { AsyncResult } = await import("effect/reactivity");
  return {
    useAtomValue: (atom: unknown) =>
      atom === null
        ? true
        : [
            {
              environmentId: "env",
              result: AsyncResult.success(state.items),
              connections: AsyncResult.success([]),
            },
          ],
  };
});
vi.mock("~/rpc/atomRegistry", () => ({ appAtomRegistry: { get: () => true, refresh: vi.fn() } }));
vi.mock("~/state/inbox", () => ({
  readInboxNotification: (...args: unknown[]) => state.read(...args),
  inboxEnvironment: {
    list: () => null,
    sources: () => null,
    get: () => null,
    mutate: { permissionAtom: () => null },
    reply: { permissionAtom: () => null },
    loadPreviousComments: {},
  },
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.mutate }));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: () => ({ data: null, error: null, refresh: vi.fn() }),
}));
vi.mock("~/browser/useOpenLink", () => ({ useOpenLink: () => vi.fn() }));
vi.mock("../ui/sidebar", () => ({
  SidebarContent: ({ children, fixedHeader }: { children: ReactNode; fixedHeader?: ReactNode }) => (
    <div data-slot="sidebar-content">
      {fixedHeader}
      {children}
    </div>
  ),
  SidebarGroup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("../sidebar/SidebarThreadHeader", () => ({
  SidebarThreadHeader: () => null,
  SidebarHeaderIconButton: () => null,
}));
vi.mock("./InboxNotificationContent", () => ({
  InboxSummary: () => <p>Review release</p>,
  InboxSourceContent: () => null,
  InboxOpenOriginalAction: () => null,
}));
vi.mock("./InboxNotificationMetadata", () => ({
  InboxNotificationMetadata: () => <span>Alex · #release</span>,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
vi.stubGlobal("matchMedia", () => ({
  matches: true,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));
const environmentId = EnvironmentId.make("env");
const projectId = ProjectId.make("project");
const threadId = ThreadId.make("inbox:notification");
const notification: InboxNotification = {
  id: "notification",
  projectId,
  source: "slack",
  connectionId: "team",
  groupId: "thread",
  revision: 0,
  state: { read: true, placement: "active", snoozedUntil: null, threadId: null },
  items: [
    {
      id: "message",
      source: "slack",
      connectionId: "team",
      groupId: "thread",
      location: "#release",
      title: "Review release",
      author: "Alex",
      content: "Review release notes",
      url: "https://slack.com",
      occurredAt: "2026-10-23T10:00:00Z",
    },
  ],
  analysis: null,
  analysisVersion: 0,
  analysisAttempts: 0,
  analysisRetryAt: null,
  processingError: null,
  agentStatus: "idle",
  agentError: null,
  agentAttempt: 0,
  agentIntent: null,
  linkedChatSettled: false,
  updatedAt: "2026-10-23T10:00:00Z",
  confirmedOutcome: null,
};
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  dismissContextMenu();
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.clearAllMocks();
  state.summary = false;
  state.resolutions = false;
  useComposerDraftStore.getState().setPrompt({ environmentId, threadId }, "");
});

it.each(["Meta", "Control"])(
  "opens Snooze for a focused notification with %s+Shift+H and applies the chosen preset",
  async (modifier) => {
    state.items = [notification];
    state.mutate.mockResolvedValue({
      _tag: "Success",
      value: { notification, openThread: false, undoCommandId: null },
    });
    useInboxNavigation.setState({ tab: "inbox", revealId: null, revealed: null });
    await act(async () =>
      root.render(
        <InboxSidebarLayout
          projects={[{ environmentId, projectId }]}
          threadRef={null}
          chatCount={0}
          chatHeader={null}
        >
          <div>Current chat</div>
        </InboxSidebarLayout>,
      ),
    );
    const row = container.querySelector<HTMLElement>("[data-inbox-row]")!;
    await act(async () => row.focus());
    const press = (repeat = false) => {
      const event = new KeyboardEvent("keydown", {
        key: "H",
        code: "KeyH",
        metaKey: modifier === "Meta",
        ctrlKey: modifier === "Control",
        shiftKey: true,
        repeat,
        bubbles: true,
        cancelable: true,
      });
      row.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
    };
    await act(async () => press());
    const menu = document.body.querySelector<HTMLElement>('[data-level="0"]')!;
    expect(menu.textContent).toContain("Choose date and time");
    expect(state.mutate).not.toHaveBeenCalled();
    await act(async () => press(true));
    expect(document.body.querySelector('[data-level="0"]')).toBe(menu);
    // The menu becomes pointer-interactive on its first animation frame.
    await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await act(async () => menu.querySelector<HTMLButtonElement>("button")!.click());
    expect(state.mutate).toHaveBeenCalledOnce();
    expect(state.mutate.mock.calls[0]![0].input).toMatchObject({
      id: notification.id,
      action: { type: "snooze", until: expect.any(String) },
    });
  },
);

it.each([
  { label: "Snooze", id: "notification", nextId: "second" },
  { label: "Snooze", id: "second", nextId: "notification" },
  { label: "Settle", id: "notification", nextId: "second" },
  { label: "Settle", id: "second", nextId: "notification" },
])(
  "moves focus to $nextId after $label of $id, including focus returning from its menu",
  async ({ label, id, nextId }) => {
    state.items = [
      notification,
      { ...notification, id: "second", updatedAt: "2026-10-23T09:00:00Z" },
    ];
    state.mutate.mockImplementation(async ({ input }) => ({
      _tag: "Success",
      value: {
        notification: {
          ...state.items.find((item) => item.id === input.id)!,
          revision: 1,
          state: {
            ...notification.state,
            placement: input.action.type === "snooze" ? "snoozed" : "resolved",
            snoozedUntil: input.action.until ?? null,
          },
        },
        openThread: false,
        undoCommandId: null,
      },
    }));
    useInboxNavigation.setState({ tab: "inbox", revealId: null, revealed: null });
    await act(async () =>
      root.render(
        <InboxSidebarLayout
          projects={[{ environmentId, projectId }]}
          threadRef={null}
          chatCount={0}
          chatHeader={null}
        >
          <div>Current chat</div>
        </InboxSidebarLayout>,
      ),
    );
    const first = container.querySelector<HTMLElement>(`[data-inbox-row="env:${id}"]`)!;
    await act(async () => first.focus());
    const action = first.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
    await act(async () => {
      action.focus();
      action.click();
    });
    if (label === "Snooze") {
      const preset = document.body.querySelector<HTMLButtonElement>('[data-level="0"] button')!;
      await act(async () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
      await act(async () => {
        preset.focus();
        preset.click();
      });
    }
    const next = container.querySelector<HTMLElement>(`[data-inbox-row="env:${nextId}"]`)!;
    expect(document.activeElement).toBe(next);
    expect(next.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(`[data-inbox-row="env:${id}"]`)).toBeNull();
  },
);

it.each([
  { linked: false, savedDraft: "", summary: true, resolutions: true },
  { linked: true, savedDraft: "", summary: true, resolutions: true },
  { linked: true, savedDraft: "My own instructions", summary: true, resolutions: true },
  { linked: true, savedDraft: "", summary: false, resolutions: true },
  { linked: true, savedDraft: "", summary: true, resolutions: false },
])(
  "opens Agent chat with an editable suggestion while preserving user drafts: %o",
  async ({ linked, savedDraft, summary, resolutions }) => {
    state.summary = summary;
    state.resolutions = resolutions;
    const analysis = {
      summary: "Review release",
      description: "Review",
      suggestions: ["Check the release notes.", "Confirm the result with Alex."],
      precedentIds: [],
      modelSelection: DEFAULT_SERVER_SETTINGS.textGenerationModelSelection,
      generatedAt: "2026-10-23T10:00:00Z",
    };
    const detail = {
      ...notification,
      analysis,
      state: { ...notification.state, placement: "delegated" as const, threadId },
    };
    state.items = [
      {
        ...notification,
        analysis: { ...analysis, suggestions: [] },
        state: { ...notification.state, threadId: linked ? threadId : null },
      },
    ];
    state.read.mockResolvedValue(detail);
    state.wait.mockResolvedValue(true);
    state.mutate.mockResolvedValue({
      _tag: "Success",
      value: { notification: detail, openThread: true, undoCommandId: null },
    });
    useComposerDraftStore.getState().setPrompt({ environmentId, threadId }, savedDraft);
    useInboxNavigation.setState({ tab: "inbox", revealId: null, revealed: null });
    await act(async () =>
      root.render(
        <>
          <InboxSidebarLayout
            projects={[{ environmentId, projectId }]}
            threadRef={null}
            chatCount={0}
            chatHeader={null}
          >
            <div>Current chat</div>
          </InboxSidebarLayout>
          <main>
            <textarea aria-label="Composer" />
          </main>
        </>,
      ),
    );
    const composer = container.querySelector("textarea")!;
    const unsubscribe = subscribeSnapShotComposerFocus(() => composer.focus());
    document.documentElement.dataset.selectedSection = "chats";
    try {
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            `button[aria-label="${linked ? "Open linked chat" : "Agent chat"}"]`,
          )!
          .click(),
      );
      expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId },
      });
      expect(
        useComposerDraftStore.getState().getComposerDraft({ environmentId, threadId })?.prompt ??
          "",
      ).toBe(
        savedDraft ||
          (summary && resolutions
            ? "Check the release notes.\n\nConfirm the result with Alex."
            : ""),
      );
      expect(document.activeElement).toBe(composer);
      expect(document.documentElement.dataset.selectedSection).toBeUndefined();
      if (linked && summary && resolutions && !savedDraft)
        expect(state.read).toHaveBeenCalledExactlyOnceWith(
          environmentId,
          projectId,
          notification.id,
        );
      else expect(state.read).not.toHaveBeenCalled();
      if (linked) expect(state.mutate).not.toHaveBeenCalled();
      else
        expect(state.mutate.mock.calls[0]![0].input.action).toEqual({
          type: "delegate",
          startAgent: false,
        });
    } finally {
      unsubscribe();
    }
  },
);
it.each([false, true])(
  "handles a new delegation even when it leaves the loaded Inbox page (direct=%s)",
  async (direct) => {
    state.items = [notification];
    useInboxNavigation.setState({ tab: "inbox", revealId: null, revealed: null });
    let release: (ready: boolean) => void = () => {};
    state.wait.mockReturnValue(
      new Promise<boolean>((resolve) => {
        release = resolve;
      }),
    );
    state.mutate.mockImplementation(async () => {
      // The delegated shelf is beyond the first page of active notifications.
      state.items = [];
      return {
        _tag: "Success",
        value: {
          notification: {
            ...notification,
            revision: 1,
            state: { ...notification.state, placement: "delegated", threadId },
            agentStatus: direct ? "starting" : "linking",
          },
          openThread: !direct,
          undoCommandId: null,
        },
      };
    });
    await act(async () =>
      root.render(
        <InboxSidebarLayout
          projects={[{ environmentId, projectId }]}
          threadRef={null}
          chatCount={0}
          chatHeader={null}
        >
          <div>Current chat</div>
        </InboxSidebarLayout>,
      ),
    );
    const button = container.querySelector<HTMLButtonElement>(
      `button[aria-label="${direct ? "Agent" : "Agent chat"}"]`,
    );
    expect(button).not.toBeNull();
    await act(async () => {
      button!.click();
    });
    expect(container.querySelector("[data-inbox-row]")).toBeNull();
    expect(state.navigate).not.toHaveBeenCalled();
    if (direct) {
      expect(state.wait).not.toHaveBeenCalled();
    } else {
      expect(state.wait).toHaveBeenCalledExactlyOnceWith({ environmentId, threadId }, 30_000);
      await act(async () => {
        release(true);
      });
      expect(state.navigate).toHaveBeenCalledExactlyOnceWith({
        to: "/$environmentId/$threadId",
        params: { environmentId, threadId },
      });
    }
  },
);

it.each(["Meta", "Control"])(
  "uses %s+arrows for section edges, crossing each boundary by only one item",
  async (modifier) => {
    state.items = (["active", "delegated", "snoozed", "resolved"] as const).flatMap((placement) =>
      Array.from({ length: placement === "snoozed" ? 1 : 4 }, (_, i) => ({
        ...notification,
        id: `${placement}-${i}`,
        state: { ...notification.state, placement },
      })),
    );
    useInboxNavigation.setState({ tab: "inbox", revealId: null, revealed: null });
    await act(async () =>
      root.render(
        <InboxSidebarLayout
          projects={[{ environmentId, projectId }]}
          threadRef={null}
          chatCount={0}
          chatHeader={null}
        >
          <span>Chats</span>
        </InboxSidebarLayout>,
      ),
    );
    const sectionButton = (label: string) =>
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.startsWith(label),
      )!;
    await act(async () => sectionButton("Delegated").click());
    const row = (id: string) =>
      container.querySelector<HTMLElement>(`[data-inbox-row="env:${id}"]`)!;
    const press = (key: string, modified = true) =>
      act(async () => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
            metaKey: modified && modifier === "Meta",
            ctrlKey: modified && modifier === "Control",
          }),
        );
      });
    const expectFocused = (id: string) => {
      expect(document.activeElement).toBe(row(id));
      expect(row(id).getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelectorAll('[data-inbox-row][aria-expanded="true"]')).toHaveLength(1);
      expect(
        container.querySelectorAll('[data-inbox-section-header] button[aria-expanded="true"]'),
      ).toHaveLength(id.startsWith("active-") ? 0 : 1);
    };
    await act(async () => row("delegated-0").focus());
    await press("ArrowDown");
    expectFocused("delegated-3");
    await press("ArrowDown");
    expectFocused("snoozed-0");
    await press("ArrowDown");
    expectFocused("resolved-0");
    await press("ArrowDown");
    expectFocused("resolved-3");
    await press("ArrowDown");
    expectFocused("resolved-3");
    await press("ArrowUp");
    expectFocused("resolved-0");
    await press("ArrowUp");
    expectFocused("snoozed-0");
    await press("ArrowUp");
    expectFocused("delegated-3");
    await press("ArrowUp");
    expectFocused("delegated-0");
    await press("ArrowUp");
    expectFocused("active-3");
    await press("ArrowUp");
    expectFocused("active-0");
    await press("ArrowUp");
    expectFocused("active-0");
    await press("ArrowDown", false);
    expectFocused("active-1");
    await act(async () => sectionButton("Delegated").click());
    await act(async () => row("delegated-3").focus());
    await press("ArrowDown");
    expectFocused("snoozed-0");
  },
);

it.each(["none", "Meta", "Control"])(
  "opens collapsed sections on boundary crossing with %s arrows in both directions",
  async (modifier) => {
    state.items = (["active", "delegated", "snoozed", "resolved"] as const).flatMap((placement) =>
      Array.from({ length: placement === "snoozed" ? 1 : 3 }, (_, i) => ({
        ...notification,
        id: `${placement}-${i}`,
        state: { ...notification.state, placement },
      })),
    );
    useInboxNavigation.setState({ tab: "inbox", revealId: null, revealed: null });
    await act(async () =>
      root.render(
        <InboxSidebarLayout
          projects={[{ environmentId, projectId }]}
          threadRef={null}
          chatCount={0}
          chatHeader={null}
        >
          <span>Chats</span>
        </InboxSidebarLayout>,
      ),
    );
    const row = (id: string) =>
      container.querySelector<HTMLElement>(`[data-inbox-row="env:${id}"]`);
    const focus = (id: string) => act(async () => row(id)!.focus());
    const press = (key: string) =>
      act(async () => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
            metaKey: modifier === "Meta",
            ctrlKey: modifier === "Control",
          }),
        );
      });
    const expectFocused = (id: string) => {
      expect(row(id)).not.toBeNull();
      expect(document.activeElement).toBe(row(id));
      expect(row(id)!.getAttribute("aria-expanded")).toBe("true");
    };
    expect(row("delegated-0")).toBeNull();
    await focus("active-2");
    await press("ArrowDown");
    expectFocused("delegated-0");
    expect(row("snoozed-0")).toBeNull();
    await focus("delegated-2");
    await press("ArrowDown");
    expectFocused("snoozed-0");
    await press("ArrowDown");
    expectFocused("resolved-0");
    expect(row("delegated-0")).toBeNull();
    expect(row("snoozed-0")).toBeNull();
    await focus("resolved-0");
    await press("ArrowUp");
    expectFocused("snoozed-0");
    expect(row("delegated-0")).toBeNull();
    await press("ArrowUp");
    expectFocused("delegated-2");
    await focus("delegated-0");
    await press("ArrowUp");
    expectFocused("active-2");
  },
);

it("opens only one shelf at a time through header clicks and Show in Inbox", async () => {
  state.items = (["delegated", "snoozed", "resolved"] as const).map((placement) => ({
    ...notification,
    id: placement,
    state: { ...notification.state, placement },
  }));
  useInboxNavigation.setState({ tab: "inbox", revealId: null, revealed: null });
  await act(async () =>
    root.render(
      <InboxSidebarLayout
        projects={[{ environmentId, projectId }]}
        threadRef={null}
        chatCount={0}
        chatHeader={null}
      >
        <span>Chats</span>
      </InboxSidebarLayout>,
    ),
  );
  const button = (section: string) =>
    container.querySelector<HTMLButtonElement>(
      `[data-inbox-section="${section}"] [data-inbox-section-header] button`,
    )!;
  const expectOpen = (section: string | null) => {
    expect([
      ...container.querySelectorAll('[data-inbox-section-header] button[aria-expanded="true"]'),
    ]).toEqual(section ? [button(section)] : []);
    expect(
      [...container.querySelectorAll<HTMLElement>("[data-inbox-row]")].map(
        (row) => row.dataset.inboxRow,
      ),
    ).toEqual(section ? [`env:${section}`] : []);
  };
  for (const section of ["delegated", "snoozed", "resolved"]) {
    await act(async () => button(section).click());
    expectOpen(section);
  }
  await act(async () => useInboxNavigation.setState({ revealId: "delegated" }));
  expectOpen("delegated");
  expect(document.activeElement).toBe(container.querySelector("[data-inbox-row]"));
  await act(async () => button("delegated").click());
  expectOpen(null);
});

it("enters a collapsed group from an empty active list and skips empty groups", async () => {
  state.items = [{ ...notification, state: { ...notification.state, placement: "snoozed" } }];
  useInboxNavigation.setState({ tab: "inbox", revealId: null, revealed: null });
  await act(async () =>
    root.render(
      <InboxSidebarLayout
        projects={[{ environmentId, projectId }]}
        threadRef={null}
        chatCount={0}
        chatHeader={null}
      >
        <span>Chats</span>
      </InboxSidebarLayout>,
    ),
  );
  expect(container.querySelector("[data-inbox-row]")).toBeNull();
  await act(async () => container.querySelector<HTMLElement>("[data-inbox-list]")!.focus());
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }),
    ),
  );
  const row = container.querySelector<HTMLElement>("[data-inbox-row]")!;
  expect(row).not.toBeNull();
  expect(document.activeElement).toBe(row);
  expect(row.getAttribute("aria-expanded")).toBe("true");
  expect(row.closest("[data-inbox-section]")?.getAttribute("data-inbox-section")).toBe("snoozed");
});

it.each(["Enter", "Tab"])(
  "enters Inbox rows from panel navigation with %s, then keeps arrows in the list",
  async (enterKey) => {
    state.items = [
      notification,
      { ...notification, id: "second", updatedAt: "2026-10-23T09:00:00Z" },
    ];
    useInboxNavigation.setState({ tab: "inbox", revealId: null, revealed: null });
    await act(async () =>
      root.render(
        <>
          <aside data-navigation-section="chats">
            <InboxSidebarLayout
              projects={[{ environmentId, projectId }]}
              threadRef={null}
              chatCount={0}
              chatHeader={null}
            >
              <button data-navigation-chat>Hidden chat</button>
            </InboxSidebarLayout>
          </aside>
          <main data-navigation-section="conversation">
            <textarea aria-label="Composer" />
          </main>
        </>,
      ),
    );
    const composer = container.querySelector("textarea")!;
    const focusComposer = vi.fn(() => composer.focus());
    const cleanup = installSectionNavigation({
      platform: "MacIntel",
      reveal: vi.fn(),
      focusComposer,
    });
    const press = (key: string, metaKey = false) =>
      act(async () => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", { key, metaKey, bubbles: true, cancelable: true }),
        );
      });
    try {
      const rows = [...container.querySelectorAll<HTMLElement>("[data-inbox-row]")];
      composer.focus();
      await press("Escape");
      await press("Escape");
      await press("ArrowLeft", true);
      expect(document.activeElement).toBe(rows[0]);
      expect(rows[0]?.getAttribute("aria-expanded")).toBe("true");
      await press("ArrowDown");
      expect(document.activeElement).toBe(rows[1]);
      await press(enterKey);
      expect(document.activeElement).toBe(rows[1]);
      expect(document.documentElement.dataset.selectedSection).toBeUndefined();
      expect(focusComposer).not.toHaveBeenCalled();
      expect(state.mutate).not.toHaveBeenCalled();
      await press("ArrowUp");
      expect(document.activeElement).toBe(rows[0]);
      const list = container.querySelector<HTMLElement>("[data-inbox-list]")!;
      await act(async () => composer.focus());
      await act(async () => list.focus());
      expect(document.activeElement).toBe(rows[0]);
      await press("ArrowDown");
      expect(document.activeElement).toBe(rows[1]);
      await press("ArrowRight", true);
      await press("ArrowLeft", true);
      expect(document.activeElement).toBe(rows[1]);
    } finally {
      cleanup();
    }
  },
);

it.each(["Meta", "Control"])(
  "keeps last-row settlement undo reachable with %s",
  async (modifier) => {
    state.items = [notification];
    let revision = 0;
    state.mutate.mockImplementation(async ({ input }) => ({
      _tag: "Success",
      value: {
        notification: {
          ...notification,
          revision: ++revision,
          state: {
            ...notification.state,
            placement: input.action.type === "resolve" ? "resolved" : "active",
          },
        },
        openThread: false,
        undoCommandId: input.action.type === "resolve" ? "undo-settle" : null,
      },
    }));
    useInboxNavigation.setState({ tab: "inbox", revealId: null, revealed: null });
    await act(async () =>
      root.render(
        <InboxSidebarLayout
          projects={[{ environmentId, projectId }]}
          threadRef={null}
          chatCount={0}
          chatHeader={null}
        >
          <div>Current chat</div>
        </InboxSidebarLayout>,
      ),
    );
    await act(async () => container.querySelector<HTMLElement>("[data-inbox-row]")!.focus());
    const press = (key: string) =>
      act(async () => {
        document.activeElement!.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            metaKey: modifier === "Meta",
            ctrlKey: modifier === "Control",
            bubbles: true,
            cancelable: true,
          }),
        );
      });
    await press("e");
    expect(container.querySelector("[data-inbox-row]")).toBeNull();
    expect(document.activeElement).toBe(container.querySelector("[data-inbox-list]"));
    await press("z");
    expect(container.querySelector("[data-inbox-row]")).not.toBeNull();
    expect(state.mutate.mock.calls.at(-1)?.[0].input.action).toEqual({
      type: "undo",
      commandId: "undo-settle",
    });
  },
);
