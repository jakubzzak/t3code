import { RegistryContext } from "@effect/atom-react";
import { AtomRegistry } from "effect/reactivity";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ProjectEntry } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import FileBrowserPanel from "./FileBrowserPanel";
import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";

const fixture = vi.hoisted(() => ({
  entries: [
    { path: "alpha.txt", kind: "file" },
    { path: "beta.txt", kind: "file" },
  ] as ProjectEntry[],
  pending: false,
  load: async () => {},
  refresh: () => {},
  loadingDirectories: new Set<string>(),
}));
vi.mock(import("./useDirectoryEntries"), async (original) => ({
  ...(await original()),
  useDirectoryEntries: (() => ({
    ...fixture,
    ready: true,
    error: null,
    isPending: false,
  })) as never,
}));
vi.mock(import("~/state/queries"), async (original) => ({
  ...(await original()),
  useProjectPathSearch: (({ query }: { query: string }) => ({
    entries: fixture.entries.filter((entry) => entry.path.includes(query)),
    ancestors: [],
    isPending: fixture.pending,
    error: null,
    truncated: false,
  })) as never,
}));
vi.mock(import("~/hooks/useTheme"), async (original) => ({
  ...(await original()),
  useTheme: (() => ({ resolvedTheme: "light" })) as never,
}));
vi.mock(import("~/composerHandleContext"), async (original) => ({
  ...(await original()),
  useComposerHandleContext: () => null,
}));
vi.mock(import("~/fileContextMenu"), async (original) => ({
  ...(await original()),
  useFileContextMenu: (() => ({})) as never,
}));

const environmentId = EnvironmentId.make("file-browser-test");

/** Mounts the panel for one chat with its own atom registry, which holds the chat's query. */
async function mountPanel() {
  fixture.pending = false;
  await using stack = new AsyncDisposableStack();
  const registry = AtomRegistry.make();
  stack.defer(() => registry.dispose());
  let chatKey = "file-browser-test:thread";
  let selectedPath: string | null = "alpha.txt";
  let revealId = 1;
  const view = () => (
    <RegistryContext value={registry}>
      <FileBrowserPanel
        key={chatKey}
        chatKey={chatKey}
        environmentId={environmentId}
        cwd="/workspace"
        projectName="workspace"
        selectedPath={selectedPath}
        selectedPathRevealId={revealId}
        onOpenFile={() => undefined}
        workspaceMutationId={null}
      />
    </RegistryContext>
  );
  const screen = stack.use(await render(view()));
  const owned = stack.move();
  const searchInput = () =>
    screen.container.querySelector<HTMLInputElement>('[name="project-files-search"]')!;
  return {
    searchInput,
    /** Shows a file the way the right panel passes it, keeping the previous reveal by default. */
    show: (path = selectedPath, id = revealId) => {
      selectedPath = path;
      revealId = id;
      return screen.rerender(view());
    },
    hide: () => screen.rerender(null),
    switchChat: (key: string) => {
      chatKey = key;
      return screen.rerender(view());
    },
    search: (value: string) => userEvent.fill(searchInput(), value),
    expectQuery: (value: string) => expect.element(searchInput()).toHaveValue(value),
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  };
}

it("keeps a broadened query after Back to a file excluded by the previous search", async () => {
  await using panel = await mountPanel();
  await panel.show("beta.txt");
  await panel.search("beta");
  await panel.show("alpha.txt");
  await panel.expectQuery("beta");
  await panel.search("a.txt");
  await panel.expectQuery("a.txt");
  await expect.element(panel.searchInput()).toHaveFocus();
});

it("keeps search across revisits to files already present in the results", async () => {
  await using panel = await mountPanel();
  await panel.show("beta.txt");
  await panel.search("a.txt");
  await panel.show("alpha.txt");
  await panel.expectQuery("a.txt");
  await panel.show(null);
  await panel.show("alpha.txt");
  await panel.expectQuery("a.txt");
});

it("does not replay a handled reveal when a search response temporarily removes its row", async () => {
  await using panel = await mountPanel();
  fixture.pending = true;
  await panel.search("a.txt");
  fixture.pending = false;
  await panel.show();
  await panel.expectQuery("a.txt");
});

it("retains the user query even when an explicit reveal follows a pending reveal", async () => {
  await using panel = await mountPanel();
  await panel.search("beta");
  await panel.show("alpha.txt", 2);
  await panel.search("a.txt");
  await panel.expectQuery("a.txt");
  await panel.show("alpha.txt", 3);
  await panel.expectQuery("a.txt");
});

it("preserves search through older visits after a file has been explicitly opened again", async () => {
  const resetStore = () =>
    useRightPanelStore.setState({ byThreadKey: {}, fileNavigationByThreadKey: {} });
  resetStore();
  using _store = { [Symbol.dispose]: resetStore };
  const ref = scopeThreadRef(environmentId, ThreadId.make("file-browser-history"));
  const store = useRightPanelStore.getState();
  await using panel = await mountPanel();
  const showActive = () => {
    const active = selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, ref);
    return panel.show(
      active?.kind === "file" ? active.relativePath : null,
      active?.kind === "file" ? active.revealRequestId : 0,
    );
  };
  store.open(ref, "files");
  store.openFile(ref, "alpha.txt");
  await showActive();
  store.openFile(ref, "beta.txt");
  await showActive();
  store.openFile(ref, "alpha.txt");
  await showActive();
  await panel.search("a.txt");
  store.navigateFileHistory(ref, -1);
  await showActive();
  await panel.expectQuery("a.txt");
  store.navigateFileHistory(ref, -1);
  await showActive();
  await panel.expectQuery("a.txt");
  store.openFile(ref, "alpha.txt");
  await showActive();
  await panel.expectQuery("a.txt");
});

it("restores the chat query after closing and remounting the side explorer", async () => {
  await using panel = await mountPanel();
  await panel.search("beta");
  await panel.hide();
  await panel.show("alpha.txt");
  await panel.expectQuery("beta");
  await panel.search("");
  await panel.hide();
  await panel.show();
  await panel.expectQuery("");
});

it("keeps independent searches when switching chat or environment", async () => {
  await using panel = await mountPanel();
  await panel.search("alpha");
  await panel.switchChat("file-browser-test:other-thread");
  await panel.expectQuery("");
  await panel.search("beta");
  await panel.switchChat("other-environment:thread");
  await panel.expectQuery("");
  await panel.search("no-match");
  await panel.switchChat("file-browser-test:thread");
  await panel.expectQuery("alpha");
  await panel.switchChat("file-browser-test:other-thread");
  await panel.expectQuery("beta");
});
