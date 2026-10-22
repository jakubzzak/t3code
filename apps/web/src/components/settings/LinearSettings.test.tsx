// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import { LinearSettings } from "./LinearSettings";

const state = vi.hoisted(() => ({
  scope: { kind: "project", members: [{ environmentId: "env", id: "one" }] },
  inboxEnabled: true,
  linearViewEnabled: false,
  workspace: "acme",
  clientId: "existing-client",
  mixed: false,
  update: vi.fn(),
}));
vi.mock("./SettingsScopeContext", () => ({
  useSettingsScope: () => ({ scope: state.scope, search: state.scope }),
}));
vi.mock("./useScopedSettings", () => ({
  useScopedSettings: (selector: (value: typeof DEFAULT_SERVER_SETTINGS) => unknown) =>
    selector({
      ...DEFAULT_SERVER_SETTINGS,
      inboxEnabled: state.inboxEnabled,
      linearViewEnabled: state.linearViewEnabled,
      linearWorkspace: state.workspace,
      linearClientId: state.clientId,
    }),
  useScopedSettingsMixed: () => state.mixed,
  useUpdateScopedSettings: () => state.update,
}));
vi.mock("./settingsLayout", () => ({
  SettingsSection: ({ children }: { children: React.ReactNode }) => <section>{children}</section>,
  SettingsRow: ({ children, control }: { children: React.ReactNode; control: React.ReactNode }) => (
    <div>
      {children}
      {control}
    </div>
  ),
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
  state.inboxEnabled = true;
  state.linearViewEnabled = false;
  vi.clearAllMocks();
});

describe("Linear project settings editing", () => {
  it("blocks edits without a project feature and allows either Inbox or Linear view", async () => {
    state.inboxEnabled = false;
    await render();
    expect(input("Linear workspace").disabled).toBe(true);
    expect(input("Linear OAuth client ID").disabled).toBe(true);
    await edit(input("Linear workspace"), "must-not-save");
    expect(state.update).not.toHaveBeenCalled();
    state.linearViewEnabled = true;
    await render();
    expect(input("Linear workspace").disabled).toBe(false);
    await edit(input("Linear workspace"), "view-only-workspace");
    expect(state.update).toHaveBeenCalledExactlyOnceWith({
      linearWorkspace: "view-only-workspace",
    });
  });

  it("saves a public client ID and allows clearing the project override", async () => {
    await render();
    await edit(input("Linear OAuth client ID"), "my-public-client");
    expect(state.update).toHaveBeenCalledExactlyOnceWith({ linearClientId: "my-public-client" });
    vi.clearAllMocks();
    await edit(input("Linear OAuth client ID"), "");
    expect(state.update).toHaveBeenCalledExactlyOnceWith({ linearClientId: "" });
  });

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
  it("requires a selected project to edit its workspace", async () => {
    state.scope = { kind: "all", members: [] };
    await render();
    expect(input("Linear workspace").disabled).toBe(true);
    state.scope = { kind: "project", members: [{ environmentId: "env", id: "one" }] };
    await render();
    await edit(input("Linear workspace"), "new-workspace");
    expect(state.update).toHaveBeenCalledExactlyOnceWith({ linearWorkspace: "new-workspace" });
  });
});
