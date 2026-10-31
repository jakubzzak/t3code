// @vitest-environment jsdom

import { EnvironmentId, FILL_PREVIEW_VIEWPORT, ThreadId } from "@t3tools/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vite-plus/test";

vi.mock("~/hooks/useSettings", () => ({ useClientSettingsHydrated: () => true }));
vi.mock("~/components/preview/previewBridge", () => ({
  previewBridge: { registerWebview: async () => {} },
}));
vi.mock("~/components/preview/usePreviewBridge", () => ({ usePreviewBridge: () => false }));
vi.mock("./previewWebviewConfigState", () => ({
  usePreviewWebviewConfig: () => ({ partition: "test", webPreferences: "", preloadUrl: null }),
}));
vi.mock("./desktopTabLifetime", () => ({
  acquireDesktopTab: () => ({ ready: Promise.resolve(), release: () => {} }),
  withDesktopTab: () => {},
}));
vi.mock("./browserRecording", () => ({ useActiveBrowserRecordingTabIds: () => new Set() }));

import { HostedBrowserWebview } from "./HostedBrowserWebview";
import { useBrowserSurfaceStore } from "./browserSurfaceStore";
import { PreviewMoreMenu } from "~/components/preview/PreviewMoreMenu";

let root: Root;
let container: HTMLDivElement;
const noop = () => {};
const surfaceOwner = Symbol("menu-test");
const menu = () => document.querySelector('[role="menu"][data-open]');

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: noop });
  useBrowserSurfaceStore.setState({ byTabId: {}, activityByTabId: {} });
  useBrowserSurfaceStore.getState().claim("tab", surfaceOwner, false);
  useBrowserSurfaceStore
    .getState()
    .present("tab", surfaceOwner, { x: 0, y: 0, width: 500, height: 400 }, true, 0, 30);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      <>
        <PreviewMoreMenu
          enabled
          actions={{
            hardReload: noop,
            setColorScheme: noop,
            zoomIn: noop,
            zoomOut: noop,
            resetZoom: noop,
            clearCookies: noop,
            clearCache: noop,
          }}
          zoomFactor={1}
          colorScheme="system"
          deviceToolbarVisible={false}
          onToggleDeviceToolbar={noop}
          nativePictureInPicture={false}
          profileName="Default"
        />
        <HostedBrowserWebview
          threadRef={{ environmentId: EnvironmentId.make("host"), threadId: ThreadId.make("chat") }}
          tabId="tab"
          runtimeTabId="tab"
          initialUrl="https://example.com"
          viewport={FILL_PREVIEW_VIEWPORT}
          pictureInPicture={false}
          profileId="default"
          zoomFactor={1}
        />
      </>,
    ),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollTo");
  vi.unstubAllGlobals();
});

async function openMenu() {
  const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Preview menu"]')!;
  await act(async () => trigger.click());
  expect(menu()).not.toBeNull();
}

async function guestMessage(channel: string) {
  const guest = container.querySelector("webview")!;
  await act(async () => guest.dispatchEvent(Object.assign(new Event("ipc-message"), { channel })));
}

it.each(["t3:preview-pointerdown", "t3:preview-escape"])(
  "dismisses the host menu on %s even without a new guest focus event",
  async (channel) => {
    await openMenu();
    await guestMessage(channel);
    expect(menu()).toBeNull();
    await openMenu();
    await guestMessage(channel);
    expect(menu()).toBeNull();
  },
);

it("leaves guest Escape out of host shortcuts when no menu is open", async () => {
  const key = vi.fn();
  document.addEventListener("keydown", key);
  try {
    await guestMessage("t3:preview-escape");
    expect(key).not.toHaveBeenCalled();
  } finally {
    document.removeEventListener("keydown", key);
  }
});

it("keeps zoom controls open and preserves ordinary host Escape dismissal", async () => {
  await openMenu();
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')!.click(),
  );
  expect(menu()).not.toBeNull();
  await act(async () =>
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }),
    ),
  );
  expect(menu()).toBeNull();
});

it("preserves outside presses in the host document", async () => {
  await openMenu();
  await act(async () =>
    container.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, pointerType: "mouse" }),
    ),
  );
  expect(menu()).toBeNull();
});

it("ignores unrelated guest messages while the menu is open", async () => {
  await openMenu();
  await guestMessage("unrelated");
  expect(menu()).not.toBeNull();
});

it.each(["t3:preview-pointerdown", "t3:preview-escape"])(
  "does not let a hidden guest dismiss the active menu through %s",
  async (channel) => {
    await act(async () => useBrowserSurfaceStore.getState().release("tab", surfaceOwner));
    await openMenu();
    await guestMessage(channel);
    expect(menu()).not.toBeNull();
  },
);
