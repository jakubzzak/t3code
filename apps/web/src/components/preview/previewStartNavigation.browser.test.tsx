import { expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { handlePreviewStartNavigation } from "./previewStartNavigation";

// Dispatches on the focused element and reports whether the handler claimed the key, which real
// input cannot observe: an unclaimed Tab must stay with the browser's default focus order.
function press(key: string, shiftKey = false) {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  document.activeElement!.dispatchEvent(event);
  return event.defaultPrevented;
}

it("traverses the URL and start-screen choices in both directions without entering toolbar controls", async () => {
  await using screen = await render(
    <div onKeyDown={handlePreviewStartNavigation}>
      <button id="back">Back</button>
      <input id="url" data-preview-url-input />
      <button id="settings">Settings</button>
      <div data-preview-start-list>
        <button id="recent">Recent</button>
        <button id="remove">Remove recent</button>
        <button id="server">Local server</button>
        <button disabled>Unavailable</button>
      </div>
    </div>,
  );
  const url = screen.container.querySelector<HTMLInputElement>("#url")!;
  url.focus();
  expect(press("Tab")).toBe(true);
  expect(document.activeElement?.id).toBe("recent");
  press("ArrowDown");
  expect(document.activeElement?.id).toBe("remove");
  press("Tab");
  expect(document.activeElement?.id).toBe("server");
  press("ArrowDown");
  expect(document.activeElement?.id).toBe("server");
  expect(press("Tab")).toBe(false);
  press("Tab", true);
  expect(document.activeElement?.id).toBe("remove");
  press("ArrowUp");
  press("ArrowUp");
  expect(document.activeElement).toBe(url);
  press("ArrowUp");
  expect(document.activeElement).toBe(url);
  expect(press("Tab", true)).toBe(false);
  expect(press("ArrowLeft")).toBe(false);
});
