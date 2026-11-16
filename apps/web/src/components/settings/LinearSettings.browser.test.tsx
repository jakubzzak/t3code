import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { LinearSettings } from "./LinearSettings";

type Scope = { kind: "project" | "all"; members: { environmentId: string; id: string }[] };

// Scope and settings are an external store, like the real context and atoms, so every reader
// re-renders on change even where the React Compiler reuses a memoized child element.
const store = vi.hoisted(() => {
  const initial = () => ({
    scope: { kind: "project", members: [{ environmentId: "env", id: "one" }] } as Scope,
    inboxEnabled: true,
    linearViewEnabled: false,
    linearWorkspace: "acme",
    linearClientId: "existing-client",
    mixed: false,
    update: (_patch: Record<string, unknown>) => undefined as void,
  });
  let snapshot = initial();
  const listeners = new Set<() => void>();
  return {
    setup: (patch: Partial<ReturnType<typeof initial>>) => {
      snapshot = { ...initial(), ...patch };
      listeners.clear();
    },
    get: () => snapshot,
    set: (patch: Partial<ReturnType<typeof initial>>) => {
      snapshot = { ...snapshot, ...patch };
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
});

vi.mock(import("./SettingsScopeContext"), async (original) => {
  const { useSyncExternalStore } = await import("react");
  return {
    ...(await original()),
    useSettingsScope: (() => {
      const { scope } = useSyncExternalStore(store.subscribe, store.get);
      return { scope, search: scope };
    }) as never,
  };
});
vi.mock(import("./useScopedSettings"), async (original) => {
  const { useSyncExternalStore } = await import("react");
  const { DEFAULT_SERVER_SETTINGS } = await import("@t3tools/contracts");
  return {
    ...(await original()),
    useScopedSettings: ((selector: (value: typeof DEFAULT_SERVER_SETTINGS) => unknown) => {
      const snapshot = useSyncExternalStore(store.subscribe, store.get);
      return selector({
        ...DEFAULT_SERVER_SETTINGS,
        inboxEnabled: snapshot.inboxEnabled,
        linearViewEnabled: snapshot.linearViewEnabled,
        linearWorkspace: snapshot.linearWorkspace,
        linearClientId: snapshot.linearClientId,
      });
    }) as never,
    useScopedSettingsMixed: () => useSyncExternalStore(store.subscribe, store.get).mixed,
    useUpdateScopedSettings: (() => store.get().update) as never,
  };
});
// The real rows gate controls on environment permissions this test does not model.
vi.mock(import("./settingsLayout"), async (original) => ({
  ...(await original()),
  SettingsSection: ({ children }: { children?: ReactNode }) => <section>{children}</section>,
  SettingsRow: (({ children, control }: { children?: ReactNode; control?: ReactNode }) => (
    <div>
      {children}
      {control}
    </div>
  )) as never,
}));

function setup(patch: Parameters<typeof store.setup>[0] = {}) {
  const update = vi.fn<(patch: Record<string, unknown>) => void>();
  store.setup({ ...patch, update });
  return { update };
}

const input = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLInputElement>(`[aria-label="${name}"]`)!;

async function edit(element: HTMLInputElement, value: string) {
  await userEvent.fill(element, value);
  element.blur();
}

describe("Linear project settings editing", () => {
  it("keeps client IDs masked until revealed without saving or replacing the input", async () => {
    const { update } = setup();
    await using screen = await render(<LinearSettings />);
    const field = input(screen.container, "Linear OAuth client ID");
    expect(field.type).toBe("password");

    await screen.getByRole("button", { name: "Show Linear OAuth client ID" }).click();
    expect(input(screen.container, "Linear OAuth client ID")).toBe(field);
    await expect.element(field).toHaveAttribute("type", "text");
    expect(update).not.toHaveBeenCalled();

    await screen.getByRole("button", { name: "Hide Linear OAuth client ID" }).click();
    await expect.element(field).toHaveAttribute("type", "password");
  });

  it("preserves an editing draft and input through server updates, then resets visibility on project change", async () => {
    const { update } = setup();
    await using screen = await render(<LinearSettings />);
    const field = input(screen.container, "Linear OAuth client ID");
    await userEvent.fill(field, "my-new-client");

    await act(() => store.set({ linearClientId: "remote-client" }));
    expect(input(screen.container, "Linear OAuth client ID")).toBe(field);
    expect(field.value).toBe("my-new-client");

    await userEvent.keyboard("{Enter}");
    expect(update).toHaveBeenCalledExactlyOnceWith({ linearClientId: "my-new-client" });

    await act(() => store.set({ linearClientId: "my-new-client" }));
    expect(input(screen.container, "Linear OAuth client ID")).toBe(field);
    await screen.getByRole("button", { name: "Show Linear OAuth client ID" }).click();
    await expect.element(field).toHaveAttribute("type", "text");

    await act(() =>
      store.set({ scope: { kind: "project", members: [{ environmentId: "env", id: "two" }] } }),
    );
    expect(input(screen.container, "Linear OAuth client ID")).not.toBe(field);
    expect(input(screen.container, "Linear OAuth client ID").type).toBe("password");
  });

  it("allows connection setup with both Inbox and Linear view off", async () => {
    const { update } = setup({ inboxEnabled: false });
    await using screen = await render(<LinearSettings />);
    expect(input(screen.container, "Linear workspace").disabled).toBe(false);
    expect(input(screen.container, "Linear OAuth client ID").disabled).toBe(false);

    await edit(input(screen.container, "Linear workspace"), "view-only-workspace");
    expect(update).toHaveBeenCalledExactlyOnceWith({ linearWorkspace: "view-only-workspace" });
  });

  it("saves a public client ID and allows clearing the project override", async () => {
    const { update } = setup();
    await using screen = await render(<LinearSettings />);
    await edit(input(screen.container, "Linear OAuth client ID"), "my-public-client");
    expect(update).toHaveBeenCalledExactlyOnceWith({ linearClientId: "my-public-client" });

    update.mockClear();
    await edit(input(screen.container, "Linear OAuth client ID"), "");
    expect(update).toHaveBeenCalledExactlyOnceWith({ linearClientId: "" });
  });

  it("preserves mixed workspace values on focus/blur and saves a deliberate replacement", async () => {
    const { update } = setup({ mixed: true });
    await using screen = await render(<LinearSettings />);
    const workspace = input(screen.container, "Linear workspace");
    await userEvent.click(workspace);
    workspace.blur();
    expect(update).not.toHaveBeenCalled();

    await edit(workspace, "new-workspace");
    expect(update).toHaveBeenCalledExactlyOnceWith({ linearWorkspace: "new-workspace" });
  });

  it("allows deliberately clearing an existing workspace", async () => {
    const { update } = setup();
    await using screen = await render(<LinearSettings />);
    await edit(input(screen.container, "Linear workspace"), "");
    expect(update).toHaveBeenCalledExactlyOnceWith({ linearWorkspace: "" });
  });

  it("requires a selected project to edit its workspace", async () => {
    const { update } = setup({ scope: { kind: "all", members: [] } });
    await using screen = await render(<LinearSettings />);
    expect(input(screen.container, "Linear workspace").disabled).toBe(true);
    expect(screen.container.textContent).not.toContain("Project setup");

    // Keyboard focus, not a pointer, is what opens the explanation.
    await userEvent.tab();
    const explanation = screen.container.querySelector<HTMLElement>(
      'span[data-slot="tooltip-trigger"]',
    )!;
    await expect.element(explanation).toHaveFocus();
    await expect.element(page.getByRole("tooltip")).toHaveTextContent("Select a project above.");

    await act(() =>
      store.set({ scope: { kind: "project", members: [{ environmentId: "env", id: "one" }] } }),
    );
    await edit(input(screen.container, "Linear workspace"), "new-workspace");
    expect(update).toHaveBeenCalledExactlyOnceWith({ linearWorkspace: "new-workspace" });
  });
});
