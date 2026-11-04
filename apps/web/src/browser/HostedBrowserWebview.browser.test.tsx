import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  FILL_PREVIEW_VIEWPORT,
  ThreadId,
  type ClientSettings,
  type DesktopPreviewBridge,
} from "@t3tools/contracts";
import type { ReactNode } from "react";

import { describe, expect, it, vi } from "vite-plus/test";
import type { previewBridge } from "~/components/preview/previewBridge";

import { act, fakeTimers, render } from "../../test/render";

const mocks = vi.hoisted(() => ({
  getClientSettings: vi.fn<() => Promise<ClientSettings | null>>(),
  setClientSettings: vi.fn<(settings: ClientSettings) => Promise<void>>(),
  createTab: vi.fn<DesktopPreviewBridge["createTab"]>(),
  closeTab: vi.fn<DesktopPreviewBridge["closeTab"]>(),
  registerWebview: vi.fn<DesktopPreviewBridge["registerWebview"]>(),
  navigate: vi.fn<DesktopPreviewBridge["navigate"]>(),
  getPreviewConfig: vi.fn<DesktopPreviewBridge["getPreviewConfig"]>(),
  automationActive: false,
}));

vi.mock(import("~/localApi"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    ensureLocalApi: () => ({ ...actual.ensureLocalApi(), persistence: mocks as never }),
  };
});

// The Electron desktop bridge; a browser has none.
vi.mock(import("~/components/preview/previewBridge"), async (original) => ({
  ...(await original()),
  previewBridge: {
    createTab: mocks.createTab,
    closeTab: mocks.closeTab,
    registerWebview: mocks.registerWebview,
    navigate: mocks.navigate,
    getPreviewConfig: mocks.getPreviewConfig,
  } as unknown as NonNullable<typeof previewBridge>,
}));

// The bridge hook reports whether an agent is driving the tab while it is not shown.
vi.mock(import("~/components/preview/usePreviewBridge"), async (original) => ({
  ...(await original()),
  usePreviewBridge: () => mocks.automationActive,
}));

import {
  __resetClientSettingsPersistenceForTests,
  ensureClientSettingsHydrated,
} from "~/hooks/useSettings";
import { useBrowserSurfaceStore } from "./browserSurfaceStore";
import { HostedBrowserWebview } from "./HostedBrowserWebview";

function deferred<A>() {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function resetStores() {
  __resetClientSettingsPersistenceForTests();
  useBrowserSurfaceStore.setState({ activityByTabId: {}, byTabId: {} });
}

function setup() {
  using stack = new DisposableStack();
  resetStores();
  stack.defer(resetStores);
  mocks.automationActive = false;
  mocks.getClientSettings.mockReset().mockResolvedValue(DEFAULT_CLIENT_SETTINGS);
  mocks.setClientSettings.mockReset().mockResolvedValue(undefined);
  mocks.createTab.mockReset().mockResolvedValue(undefined);
  mocks.closeTab.mockReset().mockResolvedValue(undefined);
  mocks.registerWebview.mockReset().mockResolvedValue(undefined);
  mocks.navigate.mockReset().mockResolvedValue(undefined);
  mocks.getPreviewConfig.mockReset().mockResolvedValue({
    partition: "persist:t3-preview-work",
    webPreferences: "contextIsolation=yes",
    preloadUrl: null,
  });
  // Chromium treats <webview> as an unknown element; give it the one Electron method the
  // host calls once the guest attaches.
  const createElement = document.createElement.bind(document);
  stack.use(
    vi.spyOn(document, "createElement").mockImplementation(((
      tagName: string,
      options?: ElementCreationOptions,
    ) => {
      const element = createElement(tagName, options);
      return tagName === "webview"
        ? Object.assign(element, { getWebContentsId: () => 51 })
        : element;
    }) as typeof document.createElement),
  );
  return stack.move();
}

// The webview releases its desktop tab on a timer after unmount; run it before the test ends
// so it cannot land in the next one.
async function renderHost(ui: ReactNode) {
  await act(() => ensureClientSettingsHydrated());
  await using stack = new AsyncDisposableStack();
  const screen = stack.use(await render(ui));
  stack.defer(async () => {
    using _timers = fakeTimers();
    await screen.unmount();
    await vi.advanceTimersByTimeAsync(0);
  });
  const environment = stack.move();
  return Object.assign(screen, { [Symbol.asyncDispose]: () => environment.disposeAsync() });
}

describe("HostedBrowserWebview Linear surface", () => {
  it("loads Linear only after native registration and does not retarget on rerender", async () => {
    using _setup = setup();
    const registration = deferred<void>();
    mocks.registerWebview.mockReturnValue(registration.promise);
    const runtimeTabId = "linear-initial";
    const webview = (initialUrl: string) => (
      <HostedBrowserWebview
        threadRef={{
          environmentId: EnvironmentId.make("linear-initial"),
          threadId: ThreadId.make("thread"),
        }}
        tabId="server-linear"
        runtimeTabId={runtimeTabId}
        surface="linear"
        initialUrl={initialUrl}
        viewport={FILL_PREVIEW_VIEWPORT}
        pictureInPicture={false}
        profileId="work"
        zoomFactor={1}
      />
    );
    useBrowserSurfaceStore.getState().acquireActivity(runtimeTabId);

    await using screen = await renderHost(webview("https://linear.app/acme/issue/ENG-1"));
    const guest = screen.container.querySelector("webview")!;

    await vi.waitFor(() => expect(mocks.registerWebview).toHaveBeenCalledOnce());
    expect(mocks.createTab).toHaveBeenCalledWith(
      runtimeTabId,
      expect.objectContaining({ surface: "linear" }),
    );
    expect(guest.getAttribute("src")).toBe("about:blank");
    expect(mocks.navigate).not.toHaveBeenCalled();

    await act(async () => {
      registration.resolve();
      await registration.promise;
    });
    await vi.waitFor(() =>
      expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
        runtimeTabId,
        "https://linear.app/acme/issue/ENG-1",
      ),
    );

    await screen.rerender(webview("https://linear.app/acme/issue/ENG-2"));
    await act(async () => {
      guest.dispatchEvent(new Event("dom-ready"));
      await Promise.resolve();
    });
    expect(mocks.registerWebview).toHaveBeenCalledOnce();
    expect(mocks.navigate).toHaveBeenCalledOnce();
  });
});

describe("HostedBrowserWebview unattended automation", () => {
  it("keeps only the automation tab paintable without revealing it", async () => {
    using _setup = setup();
    const runtimeTabId = "activity-tab";
    // A new element each time, so a rerender reads the latest automation state.
    const webview = () => (
      <HostedBrowserWebview
        threadRef={{
          environmentId: EnvironmentId.make("activity-env"),
          threadId: ThreadId.make("activity-thread"),
        }}
        tabId="server-tab"
        runtimeTabId={runtimeTabId}
        initialUrl="about:blank"
        viewport={FILL_PREVIEW_VIEWPORT}
        pictureInPicture={false}
        profileId={undefined}
        zoomFactor={1}
        serverDriven
      />
    );

    await using screen = await renderHost(webview());
    const wrapper = () =>
      screen.container.querySelector<HTMLElement>(`[data-preview-viewport="${runtimeTabId}"]`)!;
    expect(wrapper().dataset.previewRendering).toBe("suspended");

    mocks.automationActive = true;
    await screen.rerender(webview());
    expect(wrapper().dataset.previewRendering).toBe("active");
    expect(wrapper().style).toMatchObject({
      left: "0px",
      top: "0px",
      pointerEvents: "none",
      zIndex: "-1",
      visibility: "visible",
    });
    expect(useBrowserSurfaceStore.getState().byTabId[runtimeTabId]?.visible ?? false).toBe(false);

    mocks.automationActive = false;
    await screen.rerender(webview());
    expect(wrapper().dataset.previewRendering).toBe("suspended");
  });
});
