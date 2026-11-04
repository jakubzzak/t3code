import {
  BUILT_IN_BROWSER_PROFILES,
  DEFAULT_BROWSER_PROFILE_ID,
  DEFAULT_PREVIEW_APPEARANCE,
  DEFAULT_PREVIEW_ZOOM_FACTOR,
  EnvironmentId,
  type DesktopPreviewShortcut,
  FILL_PREVIEW_VIEWPORT,
  ThreadId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { type ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, render } from "../../../test/render";

import type { PreviewableServer } from "./useDiscoveredLocalServers";

const mocks = vi.hoisted(() => ({
  serverZoom: 1,
  adjust: vi.fn(),
  updateSnapshot: vi.fn(),
  onShortcut: vi.fn(
    (_listener: (tabId: string, action: DesktopPreviewShortcut) => void) => () => undefined,
  ),
  zoomIn: vi.fn(async (_tabId: string) => undefined),
  zoomOut: vi.fn(async (_tabId: string) => undefined),
  resetZoom: vi.fn(async (_tabId: string) => undefined),
  navigate: vi.fn(async (_tabId: string, _url: string): Promise<void> => undefined),
  rememberPreviewUrl: vi.fn(),
  readPreparedConnection: vi.fn(() => ({ httpBaseUrl: "http://172.25.85.75:3773" })),
  readEnvironmentScope: vi.fn((_environmentId?: unknown, _scope?: unknown) => true),
  setAnnotationSendEnabled: vi.fn(async (_tabId: string, _enabled: boolean): Promise<void> => {}),
  cancelPickElement: vi.fn(async (_tabId: string) => undefined),
  openPictureInPicture: vi.fn(async (_tabId: string): Promise<void> => undefined),
  closePictureInPicture: vi.fn(async (_tabId: string): Promise<void> => undefined),
  pickElement: vi.fn(),
  addPreviewAnnotation: vi.fn(),
  addImage: vi.fn(),
  pictureInPicture: false,
  showEmptyState: false,
  loading: false,
  nativeServerTab: false,
  serverEpoch: null as string | null,
  servers: [] as PreviewableServer[],
  recordingTabIds: new Set<string>(),
  recordingRuntimeTabId: null as string | null,
  recordVisitForThread: vi.fn(),
}));

const STUB_BROWSER_DEFAULTS = {
  viewport: FILL_PREVIEW_VIEWPORT,
  zoomFactor: DEFAULT_PREVIEW_ZOOM_FACTOR,
  appearance: DEFAULT_PREVIEW_APPEARANCE,
  autoShowFloatingPreview: true,
  profiles: BUILT_IN_BROWSER_PROFILES,
  profileId: DEFAULT_BROWSER_PROFILE_ID,
};

// The desktop bridge only exists inside Electron; the view reads it once at import.
vi.mock(import("./previewBridge"), async (original) => ({
  ...(await original()),
  previewBridge: {
    navigate: mocks.navigate,
    onShortcut: mocks.onShortcut,
    pickElement: mocks.pickElement,
    setAnnotationSendEnabled: mocks.setAnnotationSendEnabled,
    cancelPickElement: mocks.cancelPickElement,
    refresh: vi.fn(async () => undefined),
    goBack: vi.fn(async () => undefined),
    goForward: vi.fn(async () => undefined),
    hardReload: vi.fn(async () => undefined),
    openDevTools: vi.fn(async () => undefined),
    setColorScheme: vi.fn(async () => undefined),
    zoomIn: mocks.zoomIn,
    zoomOut: mocks.zoomOut,
    resetZoom: mocks.resetZoom,
    clearCookies: vi.fn(async () => undefined),
    clearCache: vi.fn(async () => undefined),
    pictureInPicture: {
      open: mocks.openPictureInPicture,
      close: mocks.closePictureInPicture,
    },
  } as never,
}));
vi.mock(import("~/browserHistoryStore"), async (original) => ({
  ...(await original()),
  recordVisitForThread: mocks.recordVisitForThread,
}));
vi.mock(import("~/state/session"), async (original) => ({
  ...(await original()),
  readPreparedConnection: mocks.readPreparedConnection as never,
  readEnvironmentScope: mocks.readEnvironmentScope,
  useEnvironmentScope: mocks.readEnvironmentScope,
}));
vi.mock(import("~/browser/browserDefaults"), async (original) => ({
  ...(await original()),
  useBrowserDefaults: () => STUB_BROWSER_DEFAULTS,
  getBrowserDefaults: () => STUB_BROWSER_DEFAULTS,
}));
vi.mock(import("~/previewStateStore"), async (original) => ({
  ...(await original()),
  rememberPreviewUrl: mocks.rememberPreviewUrl,
  updatePreviewServerSnapshot: mocks.updateSnapshot,
  useThreadPreviewState: (() => ({
    activeTabId: "tab-1",
    serverEpoch: mocks.serverEpoch,
    desktopByTabId: {
      "tab-1": {
        hasWebContents: true,
        canGoBack: false,
        canGoForward: false,
        loading: mocks.loading,
        zoomFactor: 1,
        pictureInPicture: mocks.pictureInPicture,
        colorScheme: "system",
        audioMuted: false,
        audible: false,
        controller: "none",
      },
    },
    recentlySeenUrls: [],
    sessions: mocks.showEmptyState
      ? {}
      : {
          "tab-1": {
            threadId: "thread-1",
            tabId: "tab-1",
            runtime: mocks.nativeServerTab ? "server" : "desktop",
            zoomFactor: mocks.serverZoom,
            navStatus: { _tag: "Success", url: "http://example.com/", title: "Example" },
            canGoBack: false,
            canGoForward: false,
            updatedAt: "2026-07-13T00:00:00.000Z",
          },
        },
  })) as never,
}));
vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  useEnvironment: (() => ({ label: "WSL" })) as never,
  useEnvironmentHttpBaseUrl: () => "http://172.25.85.75:3773",
  usePrimaryEnvironmentId: () => null,
}));
vi.mock(import("~/browser/browserRecording"), async (original) => ({
  ...(await original()),
  findActiveBrowserRecordingRuntimeTabId: () => mocks.recordingRuntimeTabId,
  useActiveBrowserRecordingTabIds: () => mocks.recordingTabIds,
}));
vi.mock(import("./useDiscoveredLocalServers"), async (original) => ({
  ...(await original()),
  useDiscoveredLocalServers: () => mocks.servers,
}));
vi.mock(import("./usePreviewSession"), async (original) => ({
  ...(await original()),
  usePreviewSession: () => {},
}));

vi.mock(import("~/browser/previewRuntime"), async (original) => ({
  ...(await original()),
  useRendersServerTabNatively: () => mocks.nativeServerTab,
}));

vi.mock(import("~/browser/browserViewportActions"), { spy: true });
// Only the zoom command is replaced; server-owned tabs adjust zoom through it.
vi.mock(import("~/state/use-atom-command"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    useAtomCommand: ((command: never, options?: never) =>
      options === "preview appearance or zoom"
        ? mocks.adjust
        : actual.useAtomCommand(command, options)) as never,
  };
});

import { useComposerDraftStore } from "~/composerDraftStore";
import { useBrowserPointerStore } from "~/browser/browserPointerStore";
import { previewRuntimeTabId } from "~/browser/previewRuntimeTabId";
import { usePreviewMiniPlayerStore } from "~/previewMiniPlayerStore";
import { dispatchPreviewAction } from "./previewActionBus";
import { PreviewView } from "./PreviewView";
import { ToastProvider, toastManager } from "~/components/ui/toast";
import { isMacPlatform } from "~/lib/utils";

const TEST_THREAD_REF = {
  environmentId: EnvironmentId.make("environment-1"),
  threadId: ThreadId.make("thread-1"),
} as const;
const TEST_RUNTIME_TAB_ID = previewRuntimeTabId(TEST_THREAD_REF, null, "tab-1");

function view(onSendAnnotation?: ComponentProps<typeof PreviewView>["onSendAnnotation"]) {
  return (
    <PreviewView
      threadRef={TEST_THREAD_REF}
      tabId="tab-1"
      visible
      {...(onSendAnnotation ? { onSendAnnotation } : {})}
    />
  );
}

function annotation(id: string, screenshot: unknown = null) {
  return {
    id,
    pageUrl: "https://example.com/dashboard",
    pageTitle: "Dashboard",
    comment: "Tighten this spacing",
    elements: [],
    regions: [],
    strokes: [],
    styleChanges: [],
    screenshot,
    createdAt: "2026-07-27T00:00:00.000Z",
  };
}

// The mocked modules and stores are shared by the whole file, so every test starts by
// resetting them.
function setup() {
  vi.clearAllMocks();
  mocks.readEnvironmentScope.mockReset().mockReturnValue(true);
  mocks.setAnnotationSendEnabled.mockReset().mockResolvedValue(undefined);
  mocks.pickElement.mockReset();
  mocks.pictureInPicture = false;
  mocks.showEmptyState = false;
  mocks.loading = false;
  mocks.nativeServerTab = false;
  mocks.serverEpoch = null;
  mocks.servers = [];
  mocks.recordingTabIds = new Set();
  mocks.recordingRuntimeTabId = null;
  mocks.serverZoom = 1;
  useComposerDraftStore.setState({
    addPreviewAnnotation: mocks.addPreviewAnnotation,
    addImage: mocks.addImage,
  });
  usePreviewMiniPlayerStore.setState({ byThreadKey: {} });
  useBrowserPointerStore.setState({ byTabId: {} });
}

describe("PreviewView", () => {
  it.each(["mailto:alice@example.com", "http://"])(
    "reports rejected address %s without navigating or recording it",
    async (address) => {
      setup();
      await using _screen = await render(<ToastProvider timeout={0}>{view()}</ToastProvider>);
      const input = page.getByPlaceholder("Search or enter URL");
      await input.fill(address);
      await userEvent.keyboard("{Enter}");

      await expect.element(page.getByText("Could not open this address")).toBeVisible();
      await expect.element(page.getByText("Enter an http or https URL.")).toBeVisible();
      expect(mocks.navigate).not.toHaveBeenCalled();
      expect(mocks.recordVisitForThread).not.toHaveBeenCalled();
      await userEvent.click(page.getByRole("button", { name: "Dismiss notification" }));
    },
  );

  it("retains the annotation locally when its own environment loses access during capture", async () => {
    setup();
    const picked = annotation("annotation-revoked");
    const onSendAnnotation = vi.fn();
    let submitPick: (() => void) | undefined;
    mocks.pickElement.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          submitPick = () => resolve({ annotation: picked, submission: "send" });
        }),
    );
    await using screen = await render(view(onSendAnnotation));
    await userEvent.click(page.getByRole("button", { name: "Annotate preview" }));
    await vi.waitFor(() => expect(submitPick).toBeDefined());
    expect(mocks.setAnnotationSendEnabled).toHaveBeenLastCalledWith(TEST_RUNTIME_TAB_ID, true);

    mocks.readEnvironmentScope.mockImplementation(
      (environmentId?: unknown) => environmentId !== TEST_THREAD_REF.environmentId,
    );
    await screen.rerender(view(onSendAnnotation));
    expect(mocks.setAnnotationSendEnabled).toHaveBeenLastCalledWith(TEST_RUNTIME_TAB_ID, false);
    await act(async () => submitPick!());
    await vi.waitFor(() =>
      expect(mocks.addPreviewAnnotation).toHaveBeenCalledWith(TEST_THREAD_REF, picked),
    );
    expect(onSendAnnotation).not.toHaveBeenCalled();

    mocks.readEnvironmentScope.mockReturnValue(true);
    mocks.pickElement.mockResolvedValue({ annotation: picked, submission: "send" });
    await screen.rerender(view(onSendAnnotation));
    await userEvent.click(page.getByRole("button", { name: "Annotate preview" }));
    await vi.waitFor(() => expect(onSendAnnotation).toHaveBeenCalledWith(picked, null));
    expect(mocks.setAnnotationSendEnabled).toHaveBeenLastCalledWith(TEST_RUNTIME_TAB_ID, true);
  });

  it("still sends annotation text when the picked element's crop is malformed", async () => {
    setup();
    const picked = annotation("annotation-2", {
      dataUrl: "data:image/png;base64,%%%",
      width: 10,
      height: 10,
      cropRect: { x: 0, y: 0, width: 10, height: 10 },
    });
    const onSendAnnotation = vi.fn();
    mocks.pickElement.mockResolvedValue({ annotation: picked, submission: "send" });
    await using _screen = await render(view(onSendAnnotation));
    await userEvent.click(page.getByRole("button", { name: "Annotate preview" }));

    const sent = { ...picked, screenshot: null };
    await vi.waitFor(() => expect(onSendAnnotation).toHaveBeenCalledWith(sent, null));
    expect(mocks.addPreviewAnnotation).toHaveBeenCalledWith(TEST_THREAD_REF, sent);
    expect(mocks.addImage).not.toHaveBeenCalled();
  });

  it("focuses and selects the address from forwarded desktop actions only while visible", async () => {
    setup();
    using stack = new DisposableStack();
    const previousBridge = window.desktopBridge;
    stack.defer(() => {
      if (previousBridge) window.desktopBridge = previousBridge;
      else delete window.desktopBridge;
    });
    const listeners = new Set<(action: string) => void>();
    window.desktopBridge = {
      getWindowZoomFactor: () => 1,
      onMenuAction: (listener: (action: string) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    } as NonNullable<typeof window.desktopBridge>;
    await using screen = await render(view());
    const address = page.getByRole("textbox");
    const input = address.element() as HTMLInputElement;
    const forward = () =>
      act(() => {
        listeners.forEach((listener) => listener("preview.focusUrl"));
      });

    await forward();
    await expect.element(address).toHaveFocus();
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    await act(() => input.blur());
    await forward();
    await expect.element(address).toHaveFocus();

    await act(() => input.blur());
    await screen.rerender(
      <PreviewView threadRef={TEST_THREAD_REF} tabId="tab-1" visible={false} />,
    );
    await forward();
    await expect.element(address).not.toHaveFocus();
    expect(listeners.size).toBe(0);
  });

  it("focuses the address bar each time the focus-url shortcut fires", async () => {
    setup();
    await using _screen = await render(view());
    const address = page.getByRole("textbox");

    act(() => dispatchPreviewAction("focus-url"));
    await expect.element(address).toHaveFocus();

    (address.element() as HTMLInputElement).blur();
    await expect.element(address).not.toHaveFocus();
    act(() => dispatchPreviewAction("focus-url"));
    await expect.element(address).toHaveFocus();
  });
});

describe("PreviewView zoom shortcuts", () => {
  const zoomChord = (key: string, shiftKey = false) => {
    const mac = isMacPlatform(navigator.platform);
    return new KeyboardEvent("keydown", {
      key,
      shiftKey,
      metaKey: mac,
      ctrlKey: !mac,
      bubbles: true,
      cancelable: true,
    });
  };

  it("owns zoom inside its panel and acts on guest shortcuts only while the guest is focused", async () => {
    setup();
    await using _screen = await render(view());
    const address = page.getByRole("textbox").element() as HTMLInputElement;
    address.focus();
    for (const [key, shiftKey, operation] of [
      ["=", false, mocks.zoomIn],
      ["+", true, mocks.zoomIn],
      ["-", false, mocks.zoomOut],
      ["0", false, mocks.resetZoom],
    ] as const) {
      operation.mockClear();
      const event = zoomChord(key, shiftKey);
      await act(() => address.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
      expect(operation).toHaveBeenCalledExactlyOnceWith(TEST_RUNTIME_TAB_ID);
    }
    const plain = new KeyboardEvent("keydown", { key: "=", bubbles: true, cancelable: true });
    address.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBe(false);

    // A chord outside the panel belongs to the app.
    mocks.zoomIn.mockClear();
    const outside = document.createElement("input");
    document.body.append(outside);
    using _outside = { [Symbol.dispose]: () => outside.remove() };
    outside.focus();
    outside.dispatchEvent(zoomChord("="));
    expect(mocks.zoomIn).not.toHaveBeenCalled();

    // Native guest shortcuts arrive by tab id; only the focused guest of this tab acts.
    const onShortcut = mocks.onShortcut.mock.calls.at(-1)![0];
    await act(() => onShortcut(TEST_RUNTIME_TAB_ID, "zoom-in"));
    expect(mocks.zoomIn).not.toHaveBeenCalled();
    const guest = document.createElement("webview");
    guest.setAttribute("data-preview-tab", TEST_RUNTIME_TAB_ID);
    guest.tabIndex = 0;
    document.body.append(guest);
    using _guest = { [Symbol.dispose]: () => guest.remove() };
    guest.focus();
    await act(() => onShortcut("another-tab", "zoom-in"));
    expect(mocks.zoomIn).not.toHaveBeenCalled();
    await act(() => onShortcut(TEST_RUNTIME_TAB_ID, "zoom-in"));
    expect(mocks.zoomIn).toHaveBeenCalledExactlyOnceWith(TEST_RUNTIME_TAB_ID);
  });

  it.each([
    { zoom: 1, action: "zoom-in", next: 1.1 },
    { zoom: 1.25, action: "zoom-out", next: 1.1 },
    { zoom: 1.5, action: "reset-zoom", next: 1 },
    { zoom: 5, action: "zoom-in", next: null },
    { zoom: 0.25, action: "zoom-out", next: null },
    { zoom: 1, action: "reset-zoom", next: null },
  ] as const)("keeps $action at $zoom server-authoritative", async ({ zoom, action, next }) => {
    setup();
    mocks.nativeServerTab = true;
    mocks.serverZoom = zoom;
    mocks.adjust.mockReset().mockResolvedValue({ _tag: "Success", value: { zoomFactor: next } });
    await using screen = await render(view());
    const guest = document.createElement("webview");
    guest.setAttribute("data-preview-tab", TEST_RUNTIME_TAB_ID);
    guest.tabIndex = 0;
    document.body.append(guest);
    using _guest = { [Symbol.dispose]: () => guest.remove() };
    guest.focus();
    const shortcut = () => mocks.onShortcut.mock.calls.at(-1)![0](TEST_RUNTIME_TAB_ID, action);

    await act(shortcut);
    expect(mocks.zoomIn).not.toHaveBeenCalled();
    expect(mocks.zoomOut).not.toHaveBeenCalled();
    expect(mocks.resetZoom).not.toHaveBeenCalled();
    if (next === null) {
      expect(mocks.adjust).not.toHaveBeenCalled();
    } else {
      await vi.waitFor(() =>
        expect(mocks.updateSnapshot).toHaveBeenCalledExactlyOnceWith(TEST_THREAD_REF, {
          zoomFactor: next,
        }),
      );
      expect(mocks.adjust).toHaveBeenCalledExactlyOnceWith({
        environmentId: TEST_THREAD_REF.environmentId,
        input: { threadId: TEST_THREAD_REF.threadId, tabId: "tab-1", zoomFactor: next },
      });
      mocks.adjust.mockResolvedValue({
        _tag: "Failure",
        cause: Cause.fail(new Error("Adjustment rejected")),
      });
      mocks.updateSnapshot.mockClear();
      using toast = vi.spyOn(toastManager, "add");
      await act(shortcut);
      await vi.waitFor(() =>
        expect(toast).toHaveBeenCalledWith(
          expect.objectContaining({ type: "error", description: "Adjustment rejected" }),
        ),
      );
      expect(mocks.updateSnapshot).not.toHaveBeenCalled();
    }

    // Without preview operate access, neither shortcuts nor app actions adjust zoom.
    mocks.readEnvironmentScope.mockReturnValue(false);
    mocks.adjust.mockClear();
    await screen.rerender(view());
    await act(shortcut);
    act(() => dispatchPreviewAction(action));
    expect(mocks.adjust).not.toHaveBeenCalled();
  });
});
