import type { ReactNode } from "react";
import { type ReactElement } from "react";
import { expect, it, vi } from "vite-plus/test";
import { act, render } from "../../../test/render";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { InboxImage } from "./InboxImage";

// A real browser loads the image, so the signed URL must decode or the thumbnail falls back to text.
const { signedUrl } = vi.hoisted(() => ({
  signedUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
}));
vi.mock("~/assets/assetUrls", () => ({
  useAssetUrlState: () => ({ _tag: "Success", url: signedUrl }),
  useAssetUrlRefresh: () => vi.fn(),
}));
vi.mock("../media/MediaActions", () => ({
  MediaActions: ({ children }: { children: ReactElement }) => children,
}));

const container = document.createElement("div");
const mount = (ui: ReactNode) => render(ui, { container, router: false });

it("opens the chat image dialog without navigating and closes with focus returned to the thumbnail", async () => {
  const selectNotification = vi.fn();
  const navigateInbox = vi.fn();
  await using _screen = await mount(
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
  );
  const image = container.querySelector("img")!;
  const trigger = image.parentElement!;
  trigger.focus();
  await act(async () => trigger.click());
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog).not.toBeNull();
  expect(dialog?.textContent).toContain("Expanded image preview");
  expect(dialog?.querySelector('img[alt="Screenshot.png"]')?.getAttribute("src")).toBe(signedUrl);
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
  await expect.element(trigger).toHaveFocus();

  await act(async () => trigger.click());
  const close = document.querySelector<HTMLButtonElement>('[aria-label="Close image preview"]');
  expect(close).not.toBeNull();
  await act(async () => close!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await expect.element(trigger).toHaveFocus();
});
