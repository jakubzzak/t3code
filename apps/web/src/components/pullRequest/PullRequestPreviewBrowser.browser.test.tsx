import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, type PreviewOpenInput } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";

// Keep the real catalog atoms (the primary-environment atom reads them) and report every
// environment as connected.
vi.mock(import("~/connection/catalog"), async (original) => {
  const actual = await original();
  const { Atom, AsyncResult } = await import("effect/reactivity");
  const connection = Atom.make(AsyncResult.success({ phase: "connected" }));
  return {
    ...actual,
    environmentCatalog: {
      ...actual.environmentCatalog,
      stateAtom: () => connection as never,
    },
  };
});
const preview = vi.hoisted(() => ({
  open: vi.fn<(command: { input: PreviewOpenInput }) => Promise<unknown>>(),
  close: vi.fn<() => Promise<unknown>>(),
}));
vi.mock("~/state/preview", () => ({ previewEnvironment: preview }));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
// The slot is the part of the preview panel that hands its rect to the hosted browser.
vi.mock("../preview/PreviewPanel", async () => {
  const { BrowserSurfaceSlot } = await import("~/browser/BrowserSurfaceSlot");
  return { PreviewPanel: BrowserSurfaceSlot };
});

import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";
import { resolveHostedBrowserWebviewWrapperStyle } from "~/browser/hostedBrowserWebviewStyle";
import {
  __resetClientSettingsPersistenceForTests,
  __setClientSettingsForTests,
} from "~/hooks/useSettings";
import PullRequestPreviewBrowser from "./PullRequestPreviewBrowser";

function setup() {
  using stack = new DisposableStack();
  preview.open.mockReset().mockImplementation(async ({ input }) =>
    AsyncResult.success({
      threadId: input.threadId,
      tabId: "standalone",
      navStatus: { _tag: "Loading", url: input.url, title: "" },
      canGoBack: false,
      canGoForward: false,
      updatedAt: "2026-10-16T12:00:00Z",
    }),
  );
  preview.close.mockReset().mockResolvedValue(AsyncResult.success(undefined));
  useBrowserSurfaceStore.setState({ byTabId: {}, activityByTabId: {} });
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  stack.defer(__resetClientSettingsPersistenceForTests);
  stack.use(
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 10,
      y: 10,
      width: 500,
      height: 500,
      top: 10,
      left: 10,
      bottom: 510,
      right: 510,
      toJSON() {
        return {};
      },
    }),
  );
  return stack.move();
}

const browser = (visible: boolean) => (
  <div style={{ visibility: visible ? "visible" : "hidden" }}>
    <PullRequestPreviewBrowser
      environmentId={EnvironmentId.make("remote")}
      url="https://deployment.checkout.staging.jurata.ch"
      visible={visible}
      onClose={() => {}}
    />
  </div>
);

function hostedStyle() {
  const presentation = useBrowserSurfaceStore.getState().byTabId.standalone!;
  return resolveHostedBrowserWebviewWrapperStyle({
    active: presentation.visible,
    renderingActive: false,
    rect: presentation.rect,
    hiddenSize: { width: 500, height: 500 },
  });
}

it("removes the hosted browser's input surface when hidden and restores it without reopening", async () => {
  using _setup = setup();
  await using screen = await render(browser(true));
  await vi.waitFor(() => expect(hostedStyle().pointerEvents).toBe("auto"));
  await screen.rerender(browser(false));
  expect(
    getComputedStyle(screen.container.querySelector("[data-browser-surface-slot]")!).visibility,
  ).toBe("hidden");
  expect(hostedStyle()).toMatchObject({ pointerEvents: "none", visibility: "hidden" });
  await screen.rerender(browser(true));
  expect(hostedStyle()).toMatchObject({ pointerEvents: "auto", left: 10, top: 10 });
  expect(preview.open).toHaveBeenCalledTimes(1);
});
