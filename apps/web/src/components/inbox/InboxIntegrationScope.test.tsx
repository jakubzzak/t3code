// @vitest-environment jsdom
import { RegistryContext } from "@effect/atom-react";
import { Atom, AtomRegistry, AsyncResult } from "effect/reactivity";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  type InboxNotification,
  type InboxSourceConnection,
} from "@t3tools/contracts";
import { InboxSidebarLayout } from "./InboxSidebarLayout";
import { useInboxNavigation } from "./inboxNavigation";
const state = vi.hoisted(() => ({
  registry: null as AtomRegistry.AtomRegistry | null,
  permission: null as Atom.Atom<boolean> | null,
  sources: new Map<
    string,
    Atom.Atom<AsyncResult.AsyncResult<ReadonlyArray<InboxSourceConnection>>>
  >(),
  lists: new Map<string, Atom.Atom<AsyncResult.AsyncResult<ReadonlyArray<InboxNotification>>>>(),
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
vi.mock("~/rpc/atomRegistry", () => ({
  get appAtomRegistry() {
    return state.registry;
  },
}));
vi.mock("~/state/inbox", () => ({
  readInboxNotification: (...args: unknown[]) => state.read(...args),
  inboxEnvironment: {
    list: ({
      environmentId,
      input,
    }: {
      environmentId: string;
      input: { projectId: string; offset: number };
    }) => state.lists.get(`${environmentId}:${input.projectId}:${input.offset}`),
    sources: ({ environmentId, input }: { environmentId: string; input: { projectId: string } }) =>
      state.sources.get(`${environmentId}:${input.projectId}`),
    get: () => state.permission,
    mutate: { permissionAtom: () => state.permission },
    reply: { permissionAtom: () => state.permission },
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

it("keeps source errors scoped across real query atoms, pagination and recovery", async () => {
  const other = ProjectId.make("other");
  const healthy = ProjectId.make("healthy");
  const registry = AtomRegistry.make();
  state.registry = registry;
  state.permission = Atom.make(true);
  const failed = (projectId: ProjectId, minutes: number): InboxSourceConnection => ({
    projectId,
    source: "slack",
    enabled: true,
    connected: true,
    categories: [],
    accounts: [],
    initialLookbackDays: 7,
    lastSyncAt: new Date(Date.now() - minutes * 60_000).toISOString(),
    error: "rate limit",
    retryAt: null,
  });
  const primary = Atom.make(
    AsyncResult.success<ReadonlyArray<InboxSourceConnection>>([failed(projectId, 14)]),
  );
  const secondary = Atom.make(
    AsyncResult.success<ReadonlyArray<InboxSourceConnection>>([failed(other, 150)]),
  );
  state.sources.set(`env:${projectId}`, primary);
  state.sources.set(`env:${other}`, secondary);
  state.sources.set(`env:${healthy}`, Atom.make(AsyncResult.success([])));
  const notifications = Array.from({ length: 101 }, (_, index) => ({
    ...notification,
    id: `page-${index}`,
  }));
  state.lists.set(`env:${projectId}:0`, Atom.make(AsyncResult.success(notifications)));
  state.lists.set(
    `env:${projectId}:100`,
    Atom.make(AsyncResult.success([notifications[100]!, { ...notification, id: "next-page" }])),
  );
  for (const project of [other, healthy])
    for (const offset of [0, 100])
      state.lists.set(`env:${project}:${offset}`, Atom.make(AsyncResult.success([])));
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  useInboxNavigation.setState({ tab: "inbox", revealId: null, revealed: null });
  const render = (ids: ProjectId[]) =>
    act(async () =>
      root.render(
        <RegistryContext.Provider value={registry}>
          <InboxSidebarLayout
            projects={ids.map((projectId) => ({ environmentId, projectId }))}
            threadRef={null}
            chatCount={0}
            chatHeader={null}
          >
            Current chat
          </InboxSidebarLayout>
        </RegistryContext.Provider>,
      ),
    );
  const disclose = async () => {
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Integration updates delayed"]')!
        .click(),
    );
    return document.querySelector('[role="tooltip"]')!.textContent;
  };
  try {
    await render([projectId, other]);
    expect(await disclose()).toBe("Slack updates delayed · Last synced 2h 30m ago");
    const red = container.querySelector<HTMLSpanElement>(
      'button[aria-label="Integration updates delayed"] span',
    )!.style.backgroundColor;
    await act(async () =>
      [...container.querySelectorAll("button")]
        .find((button) => button.textContent === "Load more notifications")!
        .click(),
    );
    expect(container.querySelectorAll("[data-inbox-row]")).toHaveLength(102);
    expect(await disclose()).toBe("Slack updates delayed · Last synced 2h 30m ago");
    await render([projectId]);
    expect(await disclose()).toBe("Slack updates delayed · Last synced 14m ago");
    expect(
      container.querySelector<HTMLSpanElement>(
        'button[aria-label="Integration updates delayed"] span',
      )!.style.backgroundColor,
    ).not.toBe(red);
    await render([healthy]);
    expect(container.querySelector('button[aria-label="Integration updates delayed"]')).toBeNull();
    await render([other]);
    expect(await disclose()).toContain("2h 30m");
    await act(async () =>
      registry.set(secondary, AsyncResult.success([{ ...failed(other, 150), error: null }])),
    );
    expect(container.querySelector('button[aria-label="Integration updates delayed"]')).toBeNull();
    expect(state.navigate).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    registry.dispose();
    container.remove();
    state.sources.clear();
    state.lists.clear();
  }
});
