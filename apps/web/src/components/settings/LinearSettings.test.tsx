// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { LinearSettings } from "./LinearSettings";

const state = vi.hoisted(() => ({
  scope: { kind: "project", members: [{ environmentId: "env", id: "one" }] },
  workspace: "acme",
  mixed: false,
  emails: {} as Record<string, string>,
  update: vi.fn(),
  updateClient: vi.fn(async (_patch: unknown) => {}),
}));
vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => ({ scope: state.scope, search: state.scope }),
}));
vi.mock("./useScopedSettings", () => ({
  useScopedSettings: () => state.workspace,
  useScopedSettingsMixed: () => state.mixed,
  useUpdateScopedSettings: () => state.update,
}));
vi.mock("~/hooks/useSettings", () => ({
  useClientSettings: (
    select: (value: { linearProjectLoginEmails: Record<string, string> }) => unknown,
  ) => select({ linearProjectLoginEmails: state.emails }),
  useUpdateClientSettings: () => state.updateClient,
}));
vi.mock("./settingsLayout", () => ({
  SettingsSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  SettingsRow: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
const render = async () => {
  await act(async () => root.render(<LinearSettings />));
};
const input = (name: string) =>
  container.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!;
const edit = async (element: HTMLInputElement, value: string) => {
  await act(async () => {
    element.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.blur();
  });
};
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
  state.scope = { kind: "project", members: [{ environmentId: "env", id: "one" }] };
  state.mixed = false;
  state.emails = {};
  vi.clearAllMocks();
});

describe("Linear project settings editing", () => {
  it("preserves mixed workspace values on focus/blur and saves a deliberate replacement", async () => {
    state.mixed = true;
    await render();
    const workspace = input("Linear workspace");
    await act(async () => {
      workspace.focus();
      workspace.blur();
    });
    expect(state.update).not.toHaveBeenCalled();
    await edit(workspace, "new-workspace");
    expect(state.update).toHaveBeenCalledExactlyOnceWith({ linearWorkspace: "new-workspace" });
  });
  it("allows deliberately clearing an existing workspace", async () => {
    await render();
    await edit(input("Linear workspace"), "");
    expect(state.update).toHaveBeenCalledExactlyOnceWith({ linearWorkspace: "" });
  });
  it("retains an edit when focus arrives after the input event", async () => {
    await render();
    const email = input("Linear login email");
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
        email,
        "work@example.com",
      );
      email.dispatchEvent(new Event("input", { bubbles: true }));
      email.focus();
      email.blur();
    });
    expect(state.updateClient).toHaveBeenCalledExactlyOnceWith({
      linearProjectLoginEmails: { '["env","one"]': "work@example.com" },
    });
  });
  it("requires a project selection and shows only the selected project's email", async () => {
    state.emails = { '["env","one"]': "one@example.com", '["env","two"]': "two@example.com" };
    state.scope = { kind: "all", members: [] };
    await render();
    expect(input("Linear login email").disabled).toBe(true);
    expect(input("Linear login email").value).toBe("");
    state.scope = { kind: "project", members: [{ environmentId: "env", id: "one" }] };
    await render();
    expect(input("Linear login email").value).toBe("one@example.com");
    state.scope = { kind: "project", members: [{ environmentId: "env", id: "two" }] };
    await render();
    expect(input("Linear login email").value).toBe("two@example.com");
    await edit(input("Linear login email"), "new@example.com");
    expect(state.updateClient).toHaveBeenCalledExactlyOnceWith({
      linearProjectLoginEmails: {
        '["env","one"]': "one@example.com",
        '["env","two"]': "new@example.com",
      },
    });
  });
});
