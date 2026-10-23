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

const state = vi.hoisted(() => ({
  items: [] as InboxNotification[],
  navigate: vi.fn(),
  wait: vi.fn(),
  mutate: vi.fn(),
}));
vi.mock("@tanstack/react-router", () => ({ useRouter: () => ({ navigate: state.navigate }) }));
vi.mock("~/state/entities", () => ({
  useServerConfigs: () =>
    new Map([
      [
        "env",
        { settings: { ...DEFAULT_SERVER_SETTINGS, inboxEnabled: true, inboxAgentEnabled: true } },
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
  inboxEnvironment: {
    list: () => null,
    sources: () => null,
    get: () => null,
    mutate: { permissionAtom: () => null },
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
  await act(async () => root.unmount());
  root = createRoot(container);
  vi.clearAllMocks();
});
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
