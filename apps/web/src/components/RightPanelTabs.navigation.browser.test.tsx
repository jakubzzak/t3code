import type { PreviewSessionSnapshot } from "@t3tools/contracts";
import { useState, type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../test/render";
import type { RightPanelSurface } from "../rightPanelStore";
import { installSectionNavigation } from "../sectionNavigation";
import { RightPanelTabs } from "./RightPanelTabs";

const initial: RightPanelSurface[] = [
  { id: "files", kind: "files" },
  { id: "pull-requests", kind: "pull-requests" },
];
const noop = () => {};
const idleNavigation = { _tag: "Idle" } as const;

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

/**
 * Mounts the default panel with section navigation installed on a Mac, then moves keyboard
 * selection into the panel with Command+Right, as a user entering it would.
 */
async function mountPanel() {
  await using stack = new AsyncDisposableStack();
  stack.use(vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel"));
  const screen = stack.use(await render(<Harness />));
  stack.defer(
    installSectionNavigation({ platform: "MacIntel", reveal: noop, focusComposer: noop }),
  );
  await userEvent.keyboard("{Meta>}{ArrowRight}{/Meta}");
  await vi.waitFor(() => expect(selected()).toBe("surfaces"));
  const owned = stack.move();
  return {
    rerender: (ui: ReactNode) => screen.rerender(ui),
    [Symbol.asyncDispose]: () => owned.disposeAsync(),
  };
}

const selected = () => document.documentElement.dataset.selectedSection;
const view = () => document.querySelector("[data-current-view]")?.textContent;
const tabCount = () => document.querySelectorAll("[data-active-tab]").length;
const menu = () => page.getByRole("menu");
const expectView = (kind: string) => vi.waitFor(() => expect(view()).toBe(kind));
const expectTabs = (count: number) => vi.waitFor(() => expect(tabCount()).toBe(count));

it("keeps the active view on entry, switches only with Option arrows, and clamps both ends", async () => {
  await using _panel = await mountPanel();
  expect(view()).toBe("pull-requests");
  expect(selected()).toBe("surfaces");
  expect(document.activeElement).toBe(document.body);
  await userEvent.keyboard("{ArrowLeft}");
  expect(view()).toBe("pull-requests");
  await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}");
  await expectView("files");
  await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}");
  expect(view()).toBe("files");
  await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");
  await userEvent.keyboard("{Alt>}{ArrowRight}{/Alt}");
  await expectView("pull-requests");
  expect(document.activeElement).toBe(document.body);
});

it("enters the first input with Tab and leaves input shortcuts alone", async () => {
  await using _panel = await mountPanel();
  await userEvent.keyboard("{Tab}");
  await expect.element(page.getByRole("textbox", { name: "pull-requests input" })).toHaveFocus();
  await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}");
  await userEvent.keyboard("{Meta>}{Shift>}t{/Shift}{/Meta}");
  expect(view()).toBe("pull-requests");
  expect(tabCount()).toBe(2);
  await userEvent.keyboard("{Escape}");
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(selected()).toBe("surfaces"));
});

it("creates terminals with panel focus and repeats their kind, but cannot duplicate a singleton", async () => {
  await using _panel = await mountPanel();
  await userEvent.keyboard("{Meta>}{Shift>}t{/Shift}{/Meta}");
  expect(tabCount()).toBe(2);
  await userEvent.keyboard("t");
  await expectView("terminal");
  expect(selected()).toBe("surfaces");
  expect(document.activeElement).toBe(document.body);
  await userEvent.keyboard("{Meta>}{Shift>}t{/Shift}{/Meta}");
  await expectTabs(4);
  expect(selected()).toBe("surfaces");
});

it("opens the plus menu by keyboard and returns to panel navigation on cancel", async () => {
  await using _panel = await mountPanel();
  await userEvent.keyboard("{Meta>}t{/Meta}");
  await expect.element(menu()).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  await expect.element(menu()).not.toBeInTheDocument();
  await vi.waitFor(() => expect(document.activeElement).toBe(document.body));
  expect(selected()).toBe("surfaces");
  expect(view()).toBe("pull-requests");
});

it("retains panel navigation on a list item and lets Option arrows switch its view", async () => {
  await using panel = await mountPanel();
  await panel.rerender(<Harness list />);
  await userEvent.keyboard("{Tab}");
  await expect.element(page.getByRole("button", { name: "First list item" })).toHaveFocus();
  expect(selected()).toBe("surfaces");
  await userEvent.keyboard("{Alt>}{ArrowLeft}{/Alt}");
  await expectView("files");
});

it("opens the creation menu from the empty launcher and keeps focus after choosing a terminal", async () => {
  await using panel = await mountPanel();
  await panel.rerender(<Harness key="empty" empty />);
  await userEvent.keyboard("{Meta>}{Shift>}t{/Shift}{/Meta}");
  await expect.element(menu()).not.toBeInTheDocument();
  await userEvent.keyboard("d");
  expect(tabCount()).toBe(0);
  await userEvent.keyboard("{Meta>}t{/Meta}");
  await expect.element(menu()).toBeInTheDocument();
  await userEvent.keyboard("t");
  await expectView("terminal");
  await vi.waitFor(() => expect(document.activeElement).toBe(document.body));
  expect(selected()).toBe("surfaces");
});

it("creates another browser with panel focus without opening the chooser", async () => {
  await using _panel = await mountPanel();
  await userEvent.keyboard("b");
  await expectView("preview");
  await userEvent.keyboard("{Meta>}{Shift>}t{/Shift}{/Meta}");
  await expectTabs(4);
  await expect.element(menu()).not.toBeInTheDocument();
  expect(selected()).toBe("surfaces");
});

it("does not create an ordinary browser from an active Linear view", async () => {
  await using panel = await mountPanel();
  await panel.rerender(<Harness linear />);
  await userEvent.keyboard("b");
  await expectView("preview");
  await userEvent.keyboard("{Meta>}{Shift>}t{/Shift}{/Meta}");
  expect(tabCount()).toBe(3);
  expect(selected()).toBe("surfaces");
});

it("follows the current Linear issue and never labels it with the previous issue's name", async () => {
  const first = {
    _tag: "Success" as const,
    url: "https://linear.app/demo/issue/ENG-123/fix-login",
    title: "ENG-123 Fix login redirect",
  };
  await using panel = await mountPanel();
  await panel.rerender(<Harness linear navigation={first} />);
  await userEvent.keyboard("b");
  await expectView("preview");
  const label = () =>
    document.querySelector<HTMLButtonElement>('[data-active-tab="true"] button:last-child')!;
  expect(label().textContent).toBe("ENG-123 · Fix login redir..");
  expect(label().getAttribute("aria-label")).toBe("ENG-123 · Fix login redirect");

  const navigate = async (navigation: PreviewSessionSnapshot["navStatus"]) => {
    await panel.rerender(<Harness linear navigation={navigation} />);
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
