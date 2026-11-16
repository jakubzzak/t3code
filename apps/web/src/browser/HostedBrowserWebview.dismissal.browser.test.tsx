import { EnvironmentId, FILL_PREVIEW_VIEWPORT, ThreadId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

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

import { act, render } from "../../test/render";
import { PreviewMoreMenu } from "~/components/preview/PreviewMoreMenu";
import { useBrowserSurfaceStore } from "./browserSurfaceStore";
import { HostedBrowserWebview } from "./HostedBrowserWebview";

const noop = () => {};
const surfaceOwner = Symbol("menu-test");
const menu = () => document.querySelector('[role="menu"][data-open]');

// Presents the guest below the toolbar so real clicks reach the host menu trigger.
async function renderBrowser() {
  useBrowserSurfaceStore.setState({ byTabId: {}, activityByTabId: {} });
  useBrowserSurfaceStore.getState().claim("tab", surfaceOwner, false);
  useBrowserSurfaceStore
    .getState()
    .present("tab", surfaceOwner, { x: 0, y: 400, width: 400, height: 300 }, true, 0, 30);
  return render(
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
  );
}

async function openMenu() {
  await page.getByRole("button", { name: "Preview menu" }).click();
  await vi.waitFor(() => expect(menu()).not.toBeNull());
}

// The guest page reports presses and Escape over Electron IPC, which a test can only simulate.
async function guestMessage(channel: string) {
  const guest = document.querySelector("webview")!;
  await act(() => guest.dispatchEvent(Object.assign(new Event("ipc-message"), { channel })));
}

function listenForHostKeys() {
  const key = vi.fn();
  document.addEventListener("keydown", key);
  return Object.assign(key, {
    [Symbol.dispose]: () => document.removeEventListener("keydown", key),
  });
}

it("dismisses the host menu on guest pointer presses without a new focus event", async () => {
  await using _screen = await renderBrowser();
  await openMenu();
  await guestMessage("preview:pointer-down");
  expect(menu()).toBeNull();
  await openMenu();
  await guestMessage("preview:pointer-down");
  expect(menu()).toBeNull();
});

it("does not replay guest Escape into an open host menu", async () => {
  await using _screen = await renderBrowser();
  await openMenu();
  using key = listenForHostKeys();
  await guestMessage("t3:preview-escape");
  expect(key).not.toHaveBeenCalled();
  expect(menu()).not.toBeNull();
});

it("leaves guest Escape out of host shortcuts when no menu is open", async () => {
  await using _screen = await renderBrowser();
  using key = listenForHostKeys();
  await guestMessage("t3:preview-escape");
  expect(key).not.toHaveBeenCalled();
});

it("keeps zoom controls open and preserves ordinary host Escape dismissal", async () => {
  await using _screen = await renderBrowser();
  await openMenu();
  await page.getByRole("button", { name: "Zoom in" }).click();
  expect(menu()).not.toBeNull();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(menu()).toBeNull());
});

it("preserves outside presses in the host document", async () => {
  await using _screen = await renderBrowser();
  await openMenu();
  // Beside the trigger, clear of the menu below it and the guest further down. The open menu's
  // backdrop takes the press, as it would a user's.
  await page.elementLocator(document.body).click({ position: { x: 300, y: 5 } });
  await vi.waitFor(() => expect(menu()).toBeNull());
});

it("ignores unrelated guest messages while the menu is open", async () => {
  await using _screen = await renderBrowser();
  await openMenu();
  await guestMessage("unrelated");
  expect(menu()).not.toBeNull();
});

it("does not let a hidden guest dismiss the active menu", async () => {
  await using _screen = await renderBrowser();
  await act(() => useBrowserSurfaceStore.getState().release("tab", surfaceOwner));
  await openMenu();
  await guestMessage("preview:pointer-down");
  expect(menu()).not.toBeNull();
});

it("closes the focused Appearance submenu before the root menu on host Escape", async () => {
  await using _screen = await renderBrowser();
  await openMenu();
  const appearance = document.querySelector<HTMLElement>('[data-slot="menu-sub-trigger"]')!;
  appearance.focus();
  await userEvent.keyboard("{ArrowRight}");
  const submenu = () => document.querySelector('[data-slot="menu-sub-content"][data-open]');
  await vi.waitFor(() => expect(submenu()).not.toBeNull());
  submenu()!.querySelector<HTMLElement>('[role="menuitemradio"]')!.focus();
  await userEvent.keyboard("{Escape}");
  await vi.waitFor(() => expect(submenu()).toBeNull());
  expect(menu()).not.toBeNull();
});
