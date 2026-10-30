import {
  DEFAULT_CLIENT_SETTINGS,
  EnvironmentId,
  FILL_PREVIEW_VIEWPORT,
  ThreadId,
  type ClientSettings,
  type DesktopPreviewBridge,
  type DesktopPreviewTabState,
} from "@t3tools/contracts";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const mocks = vi.hoisted(() => ({
  getClientSettings: vi.fn<() => Promise<ClientSettings | null>>(),
  setClientSettings: vi.fn<(settings: ClientSettings) => Promise<void>>(),
  createTab: vi.fn<DesktopPreviewBridge["createTab"]>(),
  closeTab: vi.fn<DesktopPreviewBridge["closeTab"]>(),
  registerWebview: vi.fn<DesktopPreviewBridge["registerWebview"]>(),
  navigate: vi.fn<DesktopPreviewBridge["navigate"]>(),
  getPreviewConfig: vi.fn<DesktopPreviewBridge["getPreviewConfig"]>(),
  activeRecordings: new Set<string>(),
  stateListeners: new Set<(tabId: string, state: DesktopPreviewTabState) => void>(),
}));

vi.mock("~/localApi", () => ({
  ensureLocalApi: () => ({ persistence: mocks }),
}));

vi.mock("~/components/preview/previewBridge", () => ({
  previewBridge: {
    createTab: mocks.createTab,
    closeTab: mocks.closeTab,
    registerWebview: mocks.registerWebview,
    navigate: mocks.navigate,
    getPreviewConfig: mocks.getPreviewConfig,
    onStateChange: (listener: (tabId: string, state: DesktopPreviewTabState) => void) => {
      mocks.stateListeners.add(listener);
      return () => mocks.stateListeners.delete(listener);
    },
  },
}));

vi.mock("~/browserFaviconStore", () => ({
  flushPendingFaviconsForThread: () => {},
  recordFaviconForThread: () => {},
  useFaviconProjectRefForThread: () => undefined,
}));
vi.mock("~/previewStateStore", () => ({ applyPreviewDesktopState: () => {} }));
vi.mock("~/state/preview", () => ({ previewEnvironment: { reportStatus: {} } }));
vi.mock("~/state/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("~/state/session")>()),
  usePreparedConnection: () => ({ _tag: "None" }),
}));
vi.mock("~/state/use-atom-command", () => ({ useAtomCommand: () => () => {} }));

vi.mock("./browserRecording", () => ({
  useActiveBrowserRecordingTabIds: () => mocks.activeRecordings,
  stopBrowserRecording: async () => null,
}));

import {
  __resetClientSettingsPersistenceForTests,
  ensureClientSettingsHydrated,
} from "~/hooks/useSettings";
import { useBrowserSurfaceStore } from "./browserSurfaceStore";
import * as desktopTabLifetime from "./desktopTabLifetime";
import { HostedBrowserWebview } from "./HostedBrowserWebview";

let renderer: ReactTestRenderer | undefined;

function deferred<A>() {
  let resolve!: (value: A) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<A>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  __resetClientSettingsPersistenceForTests();
  useBrowserSurfaceStore.setState({ activityByTabId: {}, byTabId: {} });
  mocks.getClientSettings.mockReset();
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
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("navigator", { platform: "Linux" });
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 0),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useFakeTimers();
  await act(() => renderer?.unmount());
  renderer = undefined;
  await vi.advanceTimersByTimeAsync(0);
  vi.useRealTimers();
  __resetClientSettingsPersistenceForTests();
  useBrowserSurfaceStore.setState({ activityByTabId: {}, byTabId: {} });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("HostedBrowserWebview settings hydration", () => {
  it("starts a retained background tab only after a settings read succeeds on retry", async () => {
    const firstRead = deferred<ClientSettings | null>();
    const retryRead = deferred<ClientSettings | null>();
    const tabCreation = deferred<void>();
    mocks.getClientSettings
      .mockReturnValueOnce(firstRead.promise)
      .mockReturnValueOnce(retryRead.promise);
    mocks.createTab.mockReturnValueOnce(tabCreation.promise);
    const acquire = vi.spyOn(desktopTabLifetime, "acquireDesktopTab");
    const createGuest = vi.fn((_attributes: unknown) =>
      Object.assign(new EventTarget(), { getWebContentsId: () => 41 }),
    );
    const threadRef = {
      environmentId: EnvironmentId.make("host-settings-retry"),
      threadId: ThreadId.make("thread-settings-retry"),
    };
    const runtimeTabId = "retained-background-tab";
    useBrowserSurfaceStore.getState().acquireActivity(runtimeTabId);

    await act(() => {
      renderer = create(
        <HostedBrowserWebview
          threadRef={threadRef}
          tabId="server-tab"
          runtimeTabId={runtimeTabId}
          initialUrl="https://example.com"
          viewport={FILL_PREVIEW_VIEWPORT}
          pictureInPicture={false}
          profileId="work"
          zoomFactor={1.25}
        />,
        {
          createNodeMock: (element) =>
            element.type === "webview"
              ? createGuest(element.props)
              : { scrollLeft: 0, scrollTop: 0, scrollTo: () => undefined },
        },
      );
    });

    expect(mocks.getClientSettings).toHaveBeenCalledOnce();
    expect(acquire).not.toHaveBeenCalled();
    expect(createGuest).not.toHaveBeenCalled();
    expect(mocks.createTab).not.toHaveBeenCalled();

    const failure = new Error("Saved settings are unavailable");
    await act(async () => {
      const hydration = ensureClientSettingsHydrated();
      firstRead.reject(failure);
      await expect(hydration).rejects.toBe(failure);
    });
    expect(acquire).not.toHaveBeenCalled();
    expect(createGuest).not.toHaveBeenCalled();
    expect(mocks.createTab).not.toHaveBeenCalled();

    let retry!: Promise<void>;
    await act(() => {
      retry = ensureClientSettingsHydrated();
    });
    expect(mocks.getClientSettings).toHaveBeenCalledTimes(2);
    expect(acquire).not.toHaveBeenCalled();
    expect(createGuest).not.toHaveBeenCalled();
    expect(mocks.createTab).not.toHaveBeenCalled();

    await act(async () => {
      retryRead.resolve({
        ...DEFAULT_CLIENT_SETTINGS,
        browserDefaultZoomFactor: 1.25,
        browserDefaultAppearance: "dark",
        browserProfiles: [{ id: "work", name: "Work", kind: "persistent" }],
        browserDefaultProfileId: "work",
      });
      await retry;
    });

    expect(acquire).toHaveBeenCalledExactlyOnceWith(runtimeTabId, undefined, undefined);
    expect(mocks.getPreviewConfig).toHaveBeenCalledExactlyOnceWith(threadRef.environmentId, "work");
    expect(createGuest).toHaveBeenCalledOnce();
    expect(createGuest).toHaveBeenCalledWith(
      expect.objectContaining({
        partition: "persist:t3-preview-work",
        src: "https://example.com",
      }),
    );
    expect(mocks.createTab).toHaveBeenCalledExactlyOnceWith(runtimeTabId, {
      zoomFactor: 1.25,
      colorScheme: "dark",
    });
    expect(mocks.registerWebview).not.toHaveBeenCalled();

    await act(async () => {
      tabCreation.resolve();
      await tabCreation.promise;
    });
    expect(mocks.registerWebview).toHaveBeenCalledExactlyOnceWith(runtimeTabId, 41);
    expect(mocks.closeTab).not.toHaveBeenCalled();
    expect(mocks.setClientSettings).not.toHaveBeenCalled();
  });
});

it("loads Linear only after native registration and does not retarget on rerender", async () => {
  mocks.getClientSettings.mockResolvedValue(DEFAULT_CLIENT_SETTINGS);
  const registration = deferred<void>();
  mocks.registerWebview.mockReturnValue(registration.promise);
  const guest = Object.assign(new EventTarget(), { getWebContentsId: () => 51 });
  const props = {
    threadRef: {
      environmentId: EnvironmentId.make("linear-initial"),
      threadId: ThreadId.make("thread"),
    },
    tabId: "server-linear",
    runtimeTabId: "linear-initial",
    surface: "linear" as const,
    initialUrl: "https://linear.app/acme/issue/ENG-1",
    viewport: FILL_PREVIEW_VIEWPORT,
    pictureInPicture: false,
    profileId: "work",
    zoomFactor: 1,
  };
  useBrowserSurfaceStore.getState().acquireActivity(props.runtimeTabId);
  await act(async () => {
    renderer = create(<HostedBrowserWebview {...props} />, {
      createNodeMock: (element) =>
        element.type === "webview"
          ? guest
          : { scrollLeft: 0, scrollTop: 0, scrollTo: () => undefined },
    });
  });
  expect(mocks.createTab).toHaveBeenCalledWith(
    props.runtimeTabId,
    expect.objectContaining({ surface: "linear" }),
  );
  expect(renderer!.root.findByType("webview").props.src).toBe("about:blank");
  expect(mocks.registerWebview).toHaveBeenCalledOnce();
  expect(mocks.navigate).not.toHaveBeenCalled();
  await act(async () => {
    registration.resolve();
    await registration.promise;
  });
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(props.runtimeTabId, props.initialUrl);
  await act(async () => {
    renderer!.update(
      <HostedBrowserWebview {...props} initialUrl="https://linear.app/acme/issue/ENG-2" />,
    );
    guest.dispatchEvent(new Event("dom-ready"));
  });
  expect(mocks.navigate).toHaveBeenCalledOnce();
});

it("keeps only the automation tab paintable without revealing it and suspends on release", async () => {
  mocks.getClientSettings.mockResolvedValue(DEFAULT_CLIENT_SETTINGS);
  const props = {
    threadRef: {
      environmentId: EnvironmentId.make("activity-env"),
      threadId: ThreadId.make("activity-thread"),
    },
    tabId: "server-tab",
    runtimeTabId: "activity-tab",
    initialUrl: "about:blank",
    viewport: FILL_PREVIEW_VIEWPORT,
    pictureInPicture: false,
    profileId: undefined,
    zoomFactor: 1,
    serverDriven: true,
  };
  const guest = Object.assign(new EventTarget(), { getWebContentsId: () => 52 });
  await act(async () => {
    renderer = create(<HostedBrowserWebview {...props} />, {
      createNodeMock: (element) =>
        element.type === "webview" ? guest : { scrollLeft: 0, scrollTop: 0, scrollTo: () => {} },
    });
  });
  const wrapper = () => renderer!.root.findByProps({ "data-preview-viewport": props.runtimeTabId });
  const emit = async (tabId: string, automationActive?: boolean) => {
    await act(() => {
      for (const listener of mocks.stateListeners)
        listener(tabId, {
          tabId,
          webContentsId: 52,
          navStatus: { kind: "Idle" },
          canGoBack: false,
          canGoForward: false,
          zoomFactor: 1,
          pictureInPicture: false,
          colorScheme: "system",
          audioMuted: false,
          audible: false,
          controller: "agent",
          updatedAt: "2026-10-30T00:00:00.000Z",
          ...(automationActive === undefined ? {} : { automationActive }),
        });
    });
  };
  expect(wrapper().props["data-preview-rendering"]).toBe("suspended");
  await emit("another-tab", true);
  expect(wrapper().props["data-preview-rendering"]).toBe("suspended");
  await emit(props.runtimeTabId, true);
  expect(wrapper().props.style).toMatchObject({
    left: 0,
    top: 0,
    pointerEvents: "none",
    zIndex: -1,
    visibility: "visible",
  });
  expect(useBrowserSurfaceStore.getState().byTabId[props.runtimeTabId]?.visible ?? false).toBe(
    false,
  );
  await emit(props.runtimeTabId, false);
  expect(wrapper().props["data-preview-rendering"]).toBe("suspended");
  await emit(props.runtimeTabId, true);
  await emit(props.runtimeTabId); // Older desktop versions omit activity.
  expect(wrapper().props["data-preview-rendering"]).toBe("suspended");
  await emit(props.runtimeTabId, true);
  props.runtimeTabId = "replacement-tab";
  await act(() => renderer!.update(<HostedBrowserWebview {...props} />));
  expect(wrapper().props["data-preview-rendering"]).toBe("suspended");
  props.runtimeTabId = "activity-tab";
  await act(() => renderer!.update(<HostedBrowserWebview {...props} />));
  expect(wrapper().props["data-preview-rendering"]).toBe("suspended");
  await act(() => renderer!.unmount());
  expect(mocks.stateListeners.size).toBe(0);
  renderer = undefined;
});
