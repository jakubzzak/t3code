// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";
import { handlePreviewStartNavigation } from "./previewStartNavigation";

it("traverses the URL and start-screen choices in both directions without entering toolbar controls", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
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
      ),
    );
    const url = container.querySelector<HTMLInputElement>("#url")!;
    url.focus();
    const press = (key: string, shiftKey = false) => {
      const event = new KeyboardEvent("keydown", {
        key,
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      document.activeElement!.dispatchEvent(event);
      return event.defaultPrevented;
    };
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
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  }
});
