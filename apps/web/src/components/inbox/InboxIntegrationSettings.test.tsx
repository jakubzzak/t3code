// @vitest-environment jsdom
import { act, cloneElement, type ReactElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import {
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  ProjectId,
  type InboxSourceConnection,
} from "@t3tools/contracts";
import { ProjectIntegrationSettings } from "./InboxIntegrationSettings";

const state = vi.hoisted(() => ({
  configure: vi.fn(),
  refresh: vi.fn(),
  sources: [] as InboxSourceConnection[],
  scope: { kind: "project", members: [{ environmentId: "env", id: "one" }] },
  inboxEnabled: true,
  connected: true,
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("~/state/entities", () => ({
  useServerConfigs: () => new Map([["env", { notificationInbox: true }]]),
}));
vi.mock("../settings/SettingsScopeContext", () => ({
  useSettingsScope: () => ({
    scope: state.scope,
  }),
}));
vi.mock("../settings/useScopedSettings", () => ({
  useScopedSettings: (select: (settings: typeof DEFAULT_SERVER_SETTINGS) => unknown) =>
    select({
      ...DEFAULT_SERVER_SETTINGS,
      inboxEnabled: state.inboxEnabled,
      slackClientId: "fixture-client",
    }),
}));
vi.mock("../settings/LinearSettings", () => ({
  LinearSettings: ({ children }: { children: ReactNode }) => (
    <section id="linear">{children}</section>
  ),
}));
vi.mock("./OAuthClientIdSetting", () => ({ OAuthClientIdSetting: () => null }));
vi.mock("../settings/settingsLayout", () => ({
  SettingsSection: ({ id, children }: { id: string; children: ReactNode }) => (
    <section id={id}>{children}</section>
  ),
  SettingsRow: ({
    title,
    children,
    control,
  }: {
    title: ReactNode;
    children: ReactNode;
    control: ReactNode;
  }) => (
    <div>
      {title}
      {control}
      {children}
    </div>
  ),
}));
vi.mock("../ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({
    render,
    children,
  }: {
    render: ReactElement<{ children: ReactNode }>;
    children: ReactNode;
  }) => cloneElement(render, {}, children),
  PopoverPopup: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("~/state/inbox", () => {
  const command = () => ({ permissionAtom: () => null });
  return {
    inboxEnvironment: {
      configureSource: command(),
      beginSlack: command(),
      cancelSlack: command(),
      disconnectSource: command(),
      refreshSource: command(),
      beginSuperhuman: command(),
      sources: () => ({ kind: "sources" }),
      superhumanCatalog: () => ({ kind: "catalog" }),
    },
  };
});
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => state.configure }));
vi.mock("~/state/query", () => ({
  useEnvironmentQuery: (query: { kind: string } | null) => ({
    data: !query
      ? undefined
      : query.kind === "sources"
        ? state.sources
        : {
            accounts: ["one@example.test", "two@example.test"],
            splits: [{ accountEmail: "one@example.test", id: "important", name: "Important" }],
            labels: [{ accountEmail: "two@example.test", id: "work", name: "Work" }],
          },
    refresh: state.refresh,
  }),
}));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
const render = async () => {
  state.sources = (["slack", "linear", "superhuman"] as const).map((source) => ({
    projectId: ProjectId.make("one"),
    source,
    enabled: false,
    connected: state.connected,
    categories:
      source === "slack"
        ? ["dms", "mentions", "group-mentions"]
        : source === "linear"
          ? ["all"]
          : ["split:Important", "label:Work"],
    accounts: source === "superhuman" ? ["one@example.test", "two@example.test"] : [],
    initialLookbackDays: 7,
    lastSyncAt: null,
    error: null,
    retryAt: null,
  }));
  state.configure.mockImplementation(async ({ input }) => ({
    _tag: "Success",
    value: { ...state.sources.find((source) => source.source === input.source), ...input },
  }));
  await act(async () => root.render(<ProjectIntegrationSettings />));
};
const checkbox = (source: string, label: string) =>
  [...container.querySelectorAll<HTMLLabelElement>(`#${source} label`)]
    .find((entry) => entry.textContent === label)!
    .querySelector<HTMLInputElement>("input")!;
const click = async (element: HTMLElement) => {
  await act(async () => element.click());
};
const edit = async (label: string, value: string) => {
  const field = container.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;
  await act(async () => field.focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => field.blur());
};
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  state.scope = { kind: "project", members: [{ environmentId: "env", id: "one" }] };
  state.inboxEnabled = true;
  state.connected = true;
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it("connects Superhuman and configures Slack while Inbox is off", async () => {
  state.inboxEnabled = false;
  state.connected = false;
  const popup = { opener: null, location: { href: "" } };
  vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
  await render();
  state.configure.mockResolvedValue({
    _tag: "Success",
    value: "https://auth.example.test/connect",
  });
  expect(container.textContent).not.toContain("Project setup");
  const connect = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.textContent === "Connect Superhuman",
  )!;
  expect(connect.disabled).toBe(false);
  await click(connect);
  expect(state.configure).toHaveBeenCalledWith({
    environmentId: "env",
    input: { projectId: "one" },
  });
  expect(popup.location.href).toBe("https://auth.example.test/connect");
  const slack = [...container.querySelectorAll<HTMLButtonElement>("#slack button")].find(
    (button) => button.textContent === "Connect Slack",
  )!;
  expect(slack.disabled).toBe(false);
});

it("explains disabled Connect buttons on focus without adding setup message rows", async () => {
  state.scope = { kind: "all", members: [] };
  await render();
  expect(container.textContent).not.toMatch(/Project setup|enable Inbox/);
  for (const source of ["slack", "superhuman"]) {
    const section = container.querySelector(`#${source}`)!;
    expect(section.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
    await act(async () =>
      section.querySelector<HTMLElement>('span[data-slot="tooltip-trigger"]')!.focus(),
    );
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Select a project above.");
  }
  expect(state.configure).not.toHaveBeenCalled();
});

it("automatically includes configured sources without a separate notification switch", async () => {
  await render();
  expect(container.textContent).not.toMatch(/Save selection|Apply selection/);
  expect(
    container.querySelector('[aria-label^="Enable "][aria-label$=" notifications"]'),
  ).toBeNull();
  expect(state.configure).not.toHaveBeenCalled();
  await click(checkbox("slack", "Personal mentions"));
  await click(checkbox("linear", "Assignments"));
  await click(checkbox("superhuman", "Label · Work"));
  expect(state.configure.mock.calls.map(([request]) => request.input)).toEqual([
    expect.objectContaining({
      source: "slack",
      enabled: true,
      categories: ["dms", "group-mentions"],
    }),
    expect.objectContaining({ source: "linear", enabled: true, categories: ["assignments"] }),
    expect.objectContaining({
      source: "superhuman",
      enabled: true,
      categories: ["split:Important"],
    }),
  ]);
});

it("serializes rapid edits and rolls a failed final edit back to the last saved selection", async () => {
  await render();
  let resolve!: (value: { _tag: "Success"; value: InboxSourceConnection }) => void;
  const first = new Promise<{ _tag: "Success"; value: InboxSourceConnection }>((done) => {
    resolve = done;
  });
  state.configure.mockReturnValueOnce(first).mockResolvedValueOnce({ _tag: "Failure" });
  await click(checkbox("slack", "Personal mentions"));
  await click(checkbox("slack", "Group mentions"));
  expect(state.configure).toHaveBeenCalledTimes(1);
  expect(checkbox("slack", "Group mentions").checked).toBe(false);
  await act(async () =>
    resolve({
      _tag: "Success",
      value: { ...state.sources[0]!, categories: ["dms", "group-mentions"] },
    }),
  );
  expect(state.configure).toHaveBeenCalledTimes(2);
  expect(state.configure.mock.calls[1]![0].input.categories).toEqual(["dms"]);
  expect(checkbox("slack", "Personal mentions").checked).toBe(false);
  expect(checkbox("slack", "Group mentions").checked).toBe(true);
});

it("keeps history in feature settings and connects a manual token without an extra collection opt-in", async () => {
  await render();
  expect(container.querySelector('[aria-label="Slack initial history days"]')).toBeNull();
  await edit("Slack user OAuth token", "xoxp-fixture-not-a-real-credential");
  expect(state.configure.mock.lastCall![0]).toMatchObject({
    environmentId: EnvironmentId.make("env"),
    input: { source: "slack", enabled: true },
  });
  expect(state.configure.mock.lastCall![0].input).not.toHaveProperty("initialLookbackDays");
  expect(state.configure.mock.lastCall![0].input.token).toBeDefined();
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="Slack user OAuth token"]')!.value,
  ).toBe("");
});

it("removes filters belonging only to a deselected Superhuman account and permits clearing a source", async () => {
  await render();
  await click(checkbox("superhuman", "two@example.test"));
  expect(state.configure.mock.lastCall![0].input).toMatchObject({
    accounts: ["one@example.test"],
    categories: ["split:Important"],
    enabled: true,
  });
  expect(container.querySelector("#superhuman")!.textContent).not.toContain("Label · Work");
  await click(checkbox("superhuman", "one@example.test"));
  expect(state.configure.mock.lastCall![0].input).toMatchObject({
    accounts: [],
    categories: [],
    enabled: true,
  });
  await click(checkbox("linear", "Everything"));
  expect(state.configure.mock.lastCall![0].input).toMatchObject({ categories: [], enabled: true });
});

it("pauses a source through empty filters and resumes by restoring a selection", async () => {
  await render();
  for (const [source, clear] of [
    ["slack", "Direct messages"],
    ["linear", "Everything"],
    ["superhuman", "one@example.test"],
  ] as const) {
    await click(checkbox(source, clear));
    if (source === "slack") {
      await click(checkbox(source, "Personal mentions"));
      await click(checkbox(source, "Group mentions"));
    }
    if (source === "superhuman") await click(checkbox(source, "two@example.test"));
    expect(state.configure.mock.lastCall![0].input).toMatchObject({
      source,
      enabled: true,
      categories: [],
    });
    await click(checkbox(source, clear));
    if (source === "superhuman") await click(checkbox(source, "Split · Important"));
    expect(state.configure.mock.lastCall![0].input.categories.length).toBeGreaterThan(0);
  }
});
