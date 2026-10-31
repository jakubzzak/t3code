// @vitest-environment jsdom
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { InboxImage } from "./InboxImage";

vi.mock("~/assets/assetUrls", () => ({
  useAssetUrlState: () => ({ _tag: "Success", url: "https://remote.test/signed-image" }),
  useAssetUrlRefresh: () => vi.fn(),
}));
vi.mock("../media/MediaActions", () => ({
  MediaActions: ({ children }: { children: ReactElement }) => children,
}));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const container = document.createElement("div");
document.body.append(container);
let root = createRoot(container);
afterEach(async () => {
  await act(async () => root.unmount());
  root = createRoot(container);
});

it("opens the chat image dialog without navigating and closes with focus returned to the thumbnail", async () => {
  const selectNotification = vi.fn();
  const navigateInbox = vi.fn();
  await act(async () =>
    root.render(
      <div onClick={selectNotification} onKeyDown={navigateInbox}>
        <InboxImage
          environmentId={EnvironmentId.make("remote")}
          resource={{
            _tag: "slack-image",
            projectId: ProjectId.make("project"),
            notificationId: "notification",
            fileId: "file",
          }}
          name="Screenshot.png"
        />
      </div>,
    ),
  );
  const image = container.querySelector("img")!;
  const trigger = image.parentElement!;
  trigger.focus();
  await act(async () => trigger.click());
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog?.textContent).toContain("Expanded image preview");
  expect(dialog?.querySelector('img[alt="Screenshot.png"]')?.getAttribute("src")).toBe(
    "https://remote.test/signed-image",
  );
  expect(trigger.closest("a")).toBeNull();
  expect(selectNotification).not.toHaveBeenCalled();
  await act(async () => {
    dialog!.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    dialog!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(navigateInbox).not.toHaveBeenCalled();
  expect(selectNotification).not.toHaveBeenCalled();
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  );
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);

  await act(async () => trigger.click());
  const close = document.querySelector<HTMLButtonElement>('[aria-label="Close image preview"]');
  expect(close).not.toBeNull();
  await act(async () => close!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
});
