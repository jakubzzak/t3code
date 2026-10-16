// @vitest-environment jsdom
import { DEFAULT_CLIENT_SETTINGS, EnvironmentId, type PreviewOpenInput } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";

vi.mock("~/connection/catalog", async () => {
  const { Atom, AsyncResult } = await import("effect/unstable/reactivity");
  const connection = Atom.make(AsyncResult.success({ phase: "connected" }));
  return { environmentCatalog: { stateAtom: () => connection } };
});
vi.mock("~/state/preview", async () => {
  const { AsyncResult } = await import("effect/unstable/reactivity");
  return {
    previewEnvironment: {
      open: vi.fn(async ({ input }: { input: PreviewOpenInput }) =>
        AsyncResult.success({
          threadId: input.threadId,
          tabId: "standalone",
          navStatus: { _tag: "Loading", url: input.url, title: "" },
          canGoBack: false,
          canGoForward: false,
          updatedAt: "2026-10-16T12:00:00Z",
        }),
      ),
      close: vi.fn(async () => AsyncResult.success(undefined)),
    },
  };
});
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: (command: unknown) => command }));
vi.mock("../preview/PreviewPanel", async () => {
  const { BrowserSurfaceSlot } = await import("~/browser/BrowserSurfaceSlot");
  return { PreviewPanel: BrowserSurfaceSlot };
});
import { previewEnvironment } from "~/state/preview";
import { useBrowserSurfaceStore } from "~/browser/browserSurfaceStore";
import { resolveHostedBrowserWebviewWrapperStyle } from "~/browser/hostedBrowserWebviewStyle";
import { __setClientSettingsForTests } from "~/hooks/useSettings";
import PullRequestPreviewBrowser from "./PullRequestPreviewBrowser";

let root: Root;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("removes the hosted browser's input surface when hidden and restores it without reopening", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
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
  });
  __setClientSettingsForTests(DEFAULT_CLIENT_SETTINGS);
  const mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  const render = (visible: boolean) => (
    <div style={{ visibility: visible ? "visible" : "hidden" }}>
      <PullRequestPreviewBrowser
        environmentId={EnvironmentId.make("remote")}
        url="https://deployment.checkout.staging.jurata.ch"
        visible={visible}
        onClose={() => {}}
      />
    </div>
  );
  const hostedStyle = () => {
    const presentation = useBrowserSurfaceStore.getState().byTabId.standalone!;
    return resolveHostedBrowserWebviewWrapperStyle({
      active: presentation.visible,
      renderingActive: false,
      rect: presentation.rect,
      hiddenSize: { width: 500, height: 500 },
    });
  };
  await act(async () => root.render(render(true)));
  expect(hostedStyle().pointerEvents).toBe("auto");
  await act(async () => root.render(render(false)));
  expect(getComputedStyle(mount.querySelector("[data-browser-surface-slot]")!).visibility).toBe(
    "hidden",
  );
  expect(hostedStyle()).toMatchObject({ pointerEvents: "none", visibility: "hidden" });
  await act(async () => root.render(render(true)));
  expect(hostedStyle()).toMatchObject({ pointerEvents: "auto", left: 10, top: 10 });
  expect(previewEnvironment.open).toHaveBeenCalledTimes(1);
});
