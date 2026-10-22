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
}));
vi.mock("@effect/atom-react", () => ({ useAtomValue: () => true }));
vi.mock("~/state/entities", () => ({
  useServerConfigs: () => new Map([["env", { notificationInbox: true }]]),
}));
vi.mock("../settings/SettingsScopeContext", () => ({
  useSettingsScope: () => ({
    scope: { kind: "project", members: [{ environmentId: "env", id: "one" }] },
  }),
}));
vi.mock("../settings/useScopedSettings", () => ({
  useScopedSettings: (select: (settings: typeof DEFAULT_SERVER_SETTINGS) => unknown) =>
    select({ ...DEFAULT_SERVER_SETTINGS, inboxEnabled: true }),
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
  useEnvironmentQuery: (query: { kind: string }) => ({
    data:
      query.kind === "sources"
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
    connected: true,
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
  vi.clearAllMocks();
});

it("saves each source's selections automatically without turning collection on", async () => {
  await render();
  expect(container.textContent).not.toMatch(/Save selection|Apply selection/);
  expect(state.configure).not.toHaveBeenCalled();
  await click(checkbox("slack", "Personal mentions"));
  await click(checkbox("linear", "Assignments"));
  await click(checkbox("superhuman", "Label · Work"));
  expect(state.configure.mock.calls.map(([request]) => request.input)).toEqual([
    expect.objectContaining({
      source: "slack",
      enabled: false,
      categories: ["dms", "group-mentions"],
    }),
    expect.objectContaining({ source: "linear", enabled: false, categories: ["assignments"] }),
    expect.objectContaining({
      source: "superhuman",
      enabled: false,
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

it("saves history on field commit, rejects invalid history, and connects a manual token without enabling collection", async () => {
  await render();
  await edit("Slack initial history days", "14");
  expect(state.configure.mock.lastCall![0].input.initialLookbackDays).toBe(14);
  const count = state.configure.mock.calls.length;
  await edit("Slack initial history days", "91");
  expect(state.configure).toHaveBeenCalledTimes(count);
  expect(
    container.querySelector<HTMLInputElement>('[aria-label="Slack initial history days"]')!.value,
  ).toBe("14");
  await edit("Slack user OAuth token", "xoxp-fixture-not-a-real-credential");
  expect(state.configure.mock.lastCall![0]).toMatchObject({
    environmentId: EnvironmentId.make("env"),
    input: { source: "slack", enabled: false, initialLookbackDays: 14 },
  });
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
    enabled: false,
  });
  expect(container.querySelector("#superhuman")!.textContent).not.toContain("Label · Work");
  await click(checkbox("superhuman", "one@example.test"));
  expect(state.configure.mock.lastCall![0].input).toMatchObject({
    accounts: [],
    categories: [],
    enabled: false,
  });
  await click(checkbox("linear", "Everything"));
  expect(state.configure.mock.lastCall![0].input).toMatchObject({ categories: [], enabled: false });
});

it("lets collection be turned off after clearing all filters or accounts", async () => {
  await render();
  for (const [source, name, clear] of [
    ["slack", "Slack", "Direct messages"],
    ["linear", "Linear", "Everything"],
    ["superhuman", "Superhuman", "one@example.test"],
  ]) {
    const toggle = container.querySelector<HTMLButtonElement>(
      `[aria-label="Enable ${name} notifications"]`,
    )!;
    await click(toggle);
    await click(checkbox(source!, clear!));
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
    expect(toggle.matches(":disabled, [aria-disabled=true]")).toBe(false);
    await click(toggle);
    expect(state.configure.mock.lastCall![0].input.enabled).toBe(false);
  }
});
