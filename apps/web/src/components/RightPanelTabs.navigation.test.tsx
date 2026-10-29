// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";
import type { PreviewSessionSnapshot } from "@t3tools/contracts";
import { installSectionNavigation } from "../sectionNavigation";
import type { RightPanelSurface } from "../rightPanelStore";
import { RightPanelTabs } from "./RightPanelTabs";

let root: Root;
let container: HTMLDivElement;
let cleanup: () => void;
const initial: RightPanelSurface[] = [
  { id: "files", kind: "files" },
  { id: "pull-requests", kind: "pull-requests" },
];
const noop = () => {};
const idleNavigation = { _tag: "Idle" } as const;
Element.prototype.getAnimations ??= () => [];

function Harness({
  empty = false,
  list = false,
  linear = false,
  navigation = idleNavigation,
}: {
  empty?: boolean;
  list?: boolean;
  linear?: boolean;
  navigation?: PreviewSessionSnapshot["navStatus"];
} = {}) {
  const [surfaces, setSurfaces] = useState(empty ? [] : initial);
  const [active, setActive] = useState<RightPanelSurface | null>(empty ? null : initial[1]!);
  const addBrowser = () => {
    const id = `browser:${surfaces.length}` as const;
    const next: RightPanelSurface = { id, kind: "preview", resourceId: id };
    setSurfaces([...surfaces, next]);
    setActive(next);
  };
  const addTerminal = () => {
    const id = `terminal:${surfaces.length}` as const;
    const next: RightPanelSurface = {
      id,
      kind: "terminal",
      resourceId: id,
      terminalIds: [id],
      activeTerminalId: id,
    };
    setSurfaces([...surfaces, next]);
    setActive(next);
  };
  return (
    <aside data-navigation-section="surfaces">
      <RightPanelTabs
        mode="inline"
        keybindings={[]}
        getShortcutContext={() => ({
          terminalFocus: false,
          terminalOpen: false,
          previewFocus: false,
          previewOpen: false,
          isWeb: true,
          isDesktop: false,
        })}
        surfaces={surfaces}
        activeSurfaceId={active?.id ?? null}
        environmentId={null}
        pendingSurfaceIds={new Set()}
        previewSessions={
          linear
            ? {
                "browser:2": {
                  threadId: "thread-1",
                  tabId: "browser:2",
                  surface: "linear",
                  navStatus: navigation,
                  canGoBack: false,
                  canGoForward: false,
                  updatedAt: "2026-10-05T00:00:00.000Z",
                },
              }
            : {}
        }
        desktopByTabId={{}}
        terminalLabelsById={new Map()}
        onActivate={setActive}
        onCloseSurface={noop}
        onCloseOtherSurfaces={noop}
        onCloseSurfacesToRight={noop}
        onCloseAllSurfaces={noop}
        onCopyFilePath={noop}
        onAddBrowser={addBrowser}
        onAddBrowserInProfile={addBrowser}
        onAddTerminal={addTerminal}
        onAddFiles={() => setActive(initial[0]!)}
        onAddDiff={noop}
        onAddPullRequests={() => undefined}
        onAddPullRequest={noop}
        onAddLinear={noop}
        onAddDevice={noop}
        browserAvailable
        terminalAvailable
        filesAvailable
        diffAvailable={false}
        pullRequestsAvailable={false}
        pullRequestAvailable={false}
        linearAvailable={false}
        deviceAvailable={false}
      >
        <div key={active?.id}>
          <p data-current-view>{active?.kind}</p>
          {list ? (
            <button data-panel-initial-focus>First list item</button>
          ) : (
            <input data-panel-initial-focus aria-label={`${active?.kind} input`} />
          )}
        </div>
      </RightPanelTabs>
    </aside>
  );
}

async function press(key: string, options: KeyboardEventInit = {}) {
  await act(async () => {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options }),
    );
  });
}
const selected = () => document.documentElement.dataset.selectedSection;
const view = () => document.querySelector("[data-current-view]")?.textContent;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false, addEventListener: noop, removeEventListener: noop })),
  );
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  cleanup = installSectionNavigation({ platform: "MacIntel", reveal: noop, focusComposer: noop });
  await act(async () => root.render(<Harness />));
  await press("ArrowRight", { metaKey: true });
});
afterEach(async () => {
  cleanup();
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("keeps the active view on entry, switches only with Option arrows, and clamps both ends", async () => {
  expect(view()).toBe("pull-requests");
  expect(selected()).toBe("surfaces");
  expect(document.activeElement).toBe(document.body);
  await press("ArrowLeft");
  expect(view()).toBe("pull-requests");
  await press("ArrowLeft", { altKey: true });
  expect(view()).toBe("files");
  await press("ArrowLeft", { altKey: true });
  expect(view()).toBe("files");
  await press("ArrowRight", { altKey: true });
  await press("ArrowRight", { altKey: true });
  expect(view()).toBe("pull-requests");
  expect(document.activeElement).toBe(document.body);
});

it("enters the first input with Tab and leaves input shortcuts alone", async () => {
  await press("Tab");
  expect(document.activeElement?.getAttribute("aria-label")).toBe("pull-requests input");
  await press("ArrowLeft", { altKey: true });
  await press("t", { metaKey: true, shiftKey: true });
  expect(view()).toBe("pull-requests");
  expect(document.querySelectorAll("[data-active-tab]")).toHaveLength(2);
  await press("Escape");
  await press("Escape");
  expect(selected()).toBe("surfaces");
});

it("creates terminals with panel focus and repeats their kind, but cannot duplicate a singleton", async () => {
  await press("t", { metaKey: true, shiftKey: true });
  expect(document.querySelectorAll("[data-active-tab]")).toHaveLength(2);
  await press("t");
  expect(view()).toBe("terminal");
  expect(selected()).toBe("surfaces");
  expect(document.activeElement).toBe(document.body);
  await press("t", { metaKey: true, shiftKey: true });
  expect(document.querySelectorAll("[data-active-tab]")).toHaveLength(4);
  expect(selected()).toBe("surfaces");
});

it("opens the plus menu by keyboard and returns to panel navigation on cancel", async () => {
  await press("t", { metaKey: true });
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  await press("Escape");
  expect(selected()).toBe("surfaces");
  expect(view()).toBe("pull-requests");
  expect(document.activeElement).toBe(document.body);
});

it("retains panel navigation on a list item and lets Option arrows switch its view", async () => {
  await act(async () => root.render(<Harness list />));
  await press("Tab");
  expect(document.activeElement?.textContent).toBe("First list item");
  expect(selected()).toBe("surfaces");
  await press("ArrowLeft", { altKey: true });
  expect(view()).toBe("files");
});

it("opens the creation menu from the empty launcher and keeps focus after choosing a terminal", async () => {
  await act(async () => root.render(<Harness key="empty" empty />));
  await press("t", { metaKey: true, shiftKey: true });
  expect(document.querySelector('[role="menu"]')).toBeNull();
  await press("d");
  expect(document.querySelectorAll("[data-active-tab]")).toHaveLength(0);
  await press("t", { metaKey: true });
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  await press("t");
  expect(view()).toBe("terminal");
  expect(selected()).toBe("surfaces");
  expect(document.activeElement).toBe(document.body);
});

it("creates another browser with panel focus without opening the chooser", async () => {
  await press("b");
  expect(view()).toBe("preview");
  await press("t", { metaKey: true, shiftKey: true });
  expect(document.querySelectorAll("[data-active-tab]")).toHaveLength(4);
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(selected()).toBe("surfaces");
});

it("does not create an ordinary browser from an active Linear view", async () => {
  await act(async () => root.render(<Harness linear />));
  await press("b");
  expect(view()).toBe("preview");
  await press("t", { metaKey: true, shiftKey: true });
  expect(document.querySelectorAll("[data-active-tab]")).toHaveLength(3);
  expect(selected()).toBe("surfaces");
});

it("follows the current Linear issue and never labels it with the previous issue's name", async () => {
  const first = {
    _tag: "Success" as const,
    url: "https://linear.app/demo/issue/ENG-123/fix-login",
    title: "ENG-123 Fix login redirect",
  };
  await act(async () => root.render(<Harness linear navigation={first} />));
  await press("b");
  const label = () =>
    document.querySelector<HTMLButtonElement>('[data-active-tab="true"] button:last-child')!;
  expect(label().textContent).toBe("ENG-123 · Fix login redir..");
  expect(label().getAttribute("aria-label")).toBe("ENG-123 · Fix login redirect");

  const navigate = async (navigation: PreviewSessionSnapshot["navStatus"]) => {
    await act(async () => root.render(<Harness linear navigation={navigation} />));
    return label().textContent;
  };
  const next = { ...first, url: "https://linear.app/demo/issue/ENG-456/keyboard-focus" };
  expect(await navigate({ ...next, _tag: "Loading" })).toBe("ENG-456");
  expect(await navigate({ ...next, title: "ENG-456 Preserve keyboard focus" })).toBe(
    "ENG-456 · Preserve keyboa..",
  );
  expect(await navigate({ ...next, url: "https://linear.app/demo/my-issues" })).toBe("Linear");
  expect(await navigate(first)).toBe("ENG-123 · Fix login redir..");
  expect(await navigate({ ...first, _tag: "Loading" })).toBe("ENG-123 · Fix login redir..");
  expect(await navigate({ ...first, _tag: "LoadFailed", code: -106, description: "Offline" })).toBe(
    "ENG-123 · Fix login redir..",
  );
  expect(await navigate({ ...first, title: "" })).toBe("ENG-123");
  expect(await navigate({ ...first, url: "https://accounts.google.com/signin" })).toBe("Linear");
  expect(await navigate({ _tag: "Idle" })).toBe("Linear");
});
