// @vitest-environment jsdom
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type ProjectEntry } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

import FileBrowserPanel from "./FileBrowserPanel";
import { selectActiveRightPanelSurface, useRightPanelStore } from "~/rightPanelStore";

const fixture = vi.hoisted(() => ({
  entries: [
    { path: "alpha.txt", kind: "file" },
    { path: "beta.txt", kind: "file" },
  ] as ProjectEntry[],
  pending: false,
  load: vi.fn(async () => {}),
  refresh: vi.fn(),
  loadingDirectories: new Set<string>(),
}));
vi.mock("./useDirectoryEntries", () => ({
  useDirectoryEntries: () => ({ ...fixture, ready: true, error: null, isPending: false }),
}));
vi.mock("~/state/queries", () => ({
  useProjectPathSearch: ({ query }: { query: string }) => ({
    entries: fixture.entries.filter((entry) => entry.path.includes(query)),
    ancestors: [],
    isPending: fixture.pending,
    error: null,
    truncated: false,
  }),
}));
vi.mock("@effect/atom-react", () => ({
  useAtom: () => [{ includeIgnored: true, includeTests: true }, vi.fn()],
}));
vi.mock("~/hooks/useTheme", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("~/composerHandleContext", () => ({ useComposerHandleContext: () => null }));
vi.mock("~/fileContextMenu", () => ({ useFileContextMenu: () => ({}) }));

let root: Root;
let mount: HTMLDivElement;
let selectedPath: string | null;
let revealId: number;
const environmentId = EnvironmentId.make("file-browser-test");
const onOpenFile = vi.fn();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  Element.prototype.getAnimations ??= () => [];
  fixture.pending = false;
  selectedPath = "alpha.txt";
  revealId = 1;
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
});

afterEach(async () => {
  await act(async () => root.unmount());
  mount.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function render(path = selectedPath, id = revealId) {
  selectedPath = path;
  revealId = id;
  await act(async () =>
    root.render(
      <FileBrowserPanel
        chatKey="file-browser-test:thread"
        environmentId={environmentId}
        cwd="/workspace"
        projectName="workspace"
        selectedPath={selectedPath}
        selectedPathRevealId={revealId}
        onOpenFile={onOpenFile}
        workspaceMutationId={null}
      />,
    ),
  );
}

function searchInput() {
  return mount.querySelector<HTMLInputElement>('[name="project-files-search"]')!;
}

async function search(value: string) {
  const input = searchInput();
  input.focus();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("keeps a broadened query after Back to a file excluded by the previous search", async () => {
  await render();
  await render("beta.txt");
  await search("beta");
  await render("alpha.txt");
  expect(searchInput().value).toBe("beta");
  await search("a.txt");
  expect(searchInput().value).toBe("a.txt");
  expect(document.activeElement).toBe(searchInput());
});

it("keeps search across revisits to files already present in the results", async () => {
  await render();
  await render("beta.txt");
  await search("a.txt");
  await render("alpha.txt");
  expect(searchInput().value).toBe("a.txt");
  await render(null);
  await render("alpha.txt");
  expect(searchInput().value).toBe("a.txt");
});

it("does not replay a handled reveal when a search response temporarily removes its row", async () => {
  await render();
  fixture.pending = true;
  await search("a.txt");
  fixture.pending = false;
  await render();
  expect(searchInput().value).toBe("a.txt");
});

it("lets a later search supersede an unloaded reveal but still handles a new explicit reveal", async () => {
  await render();
  await search("beta");
  await render("alpha.txt", 2);
  await search("a.txt");
  expect(searchInput().value).toBe("a.txt");
  await render("alpha.txt", 3);
  expect(searchInput().value).toBe("");
});

it("preserves search through older visits after a file has been explicitly opened again", async () => {
  useRightPanelStore.setState({ byThreadKey: {}, fileNavigationByThreadKey: {} });
  const ref = scopeThreadRef(environmentId, ThreadId.make("file-browser-history"));
  const store = useRightPanelStore.getState();
  const showActive = async () => {
    const active = selectActiveRightPanelSurface(useRightPanelStore.getState().byThreadKey, ref);
    await render(
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
  await search("a.txt");
  store.navigateFileHistory(ref, -1);
  await showActive();
  expect(searchInput().value).toBe("a.txt");
  store.navigateFileHistory(ref, -1);
  await showActive();
  expect(searchInput().value).toBe("a.txt");
  store.openFile(ref, "alpha.txt");
  await showActive();
  expect(searchInput().value).toBe("");
});
