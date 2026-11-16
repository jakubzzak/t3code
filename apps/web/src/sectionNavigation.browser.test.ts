import { describe, expect, it, vi } from "vite-plus/test";

import { fakeTimers } from "../test/render";
import {
  installSectionNavigation,
  handleContentSectionEscape,
  sectionNavigationOwnsFocus,
  releaseBrowserSectionFocus,
} from "./sectionNavigation";

const selected = () => document.documentElement.dataset.selectedSection;
const editor = () => document.querySelector<HTMLTextAreaElement>("#composer")!;
const highlighted = () => document.querySelector("[data-section-highlight]")?.id;
// Synthetic events: several cases assert on the event itself (defaultPrevented, repeat).
async function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  document.activeElement!.dispatchEvent(event);
  await Promise.resolve();
  return event;
}
const move = (key: string) => press(key, { metaKey: true });

/** Mounts the three sections and installs navigation; dispose uninstalls and removes them. */
function setup(platform = "MacIntel") {
  using stack = new DisposableStack();
  const root = stack.adopt(document.createElement("div"), (node) => node.remove());
  root.innerHTML = `
    <aside data-navigation-section="chats">
      <div data-thread-item><button data-navigation-chat id="first" aria-current="page">First chat</button></div>
      <div data-thread-item><button data-navigation-chat id="second">Second chat</button></div>
      <div hidden><div data-thread-item><button data-navigation-chat id="hidden">Collapsed chat</button></div></div>
    </aside>
    <main data-navigation-section="conversation"><textarea id="composer">Unsent draft</textarea></main>
    <aside data-navigation-section="surfaces"><input id="terminal" data-terminal-owner="right-panel"></aside>`;
  document.body.append(root);
  const reveal = vi.fn();
  const focusComposer = vi.fn(() => editor().focus());
  const uninstall = stack.adopt(
    installSectionNavigation({ platform, reveal, focusComposer }),
    (cleanup) => cleanup(),
  );
  const resources = stack.move();
  return { root, reveal, focusComposer, uninstall, [Symbol.dispose]: () => resources.dispose() };
}

describe("keyboard section navigation", () => {
  it("releases a draft with double Escape, previews chats without opening, and enters the highlight", async () => {
    using view = setup();
    const opened = vi.fn();
    document.querySelector("#second")!.addEventListener("click", opened);
    editor().focus();
    await press("Escape");
    expect(document.activeElement).toBe(editor());
    editor().dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await press("Escape");
    expect(document.activeElement).toBe(document.body);
    expect(editor().value).toBe("Unsent draft");
    expect(selected()).toBeUndefined();
    await move("ArrowLeft");
    expect(selected()).toBe("chats");
    expect(view.reveal).toHaveBeenCalledWith("chats");
    expect(highlighted()).toBe("first");
    document.activeElement!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await press("ArrowDown");
    expect(highlighted()).toBe("second");
    await press("ArrowDown");
    expect(highlighted()).toBe("second");
    await move("ArrowLeft");
    expect(highlighted()).toBe("second");
    expect(opened).not.toHaveBeenCalled();
    await press("Enter");
    expect(opened).toHaveBeenCalledOnce();
    expect(selected()).toBeUndefined();
    expect(view.focusComposer).toHaveBeenCalledOnce();
  });

  it("starts from center, reveals the right panel, clamps edges, and escapes without refocusing", async () => {
    using view = setup();
    await move("ArrowRight");
    expect(selected()).toBe("surfaces");
    expect(view.reveal).toHaveBeenCalledWith("surfaces");
    await move("ArrowRight");
    expect(selected()).toBe("surfaces");
    await press("Escape");
    expect(selected()).toBe("surfaces");
    await press("Escape");
    expect(selected()).toBeUndefined();
    expect(document.activeElement).toBe(document.body);
    await move("ArrowLeft");
    expect(selected()).toBe("conversation");
    await press("Enter");
    expect(document.activeElement).toBe(editor());
    expect(selected()).toBeUndefined();
  });

  it("leaves normal text navigation alone and releases focus from the last surface", async () => {
    using _view = setup();
    editor().focus();
    expect((await move("ArrowLeft")).defaultPrevented).toBe(false);
    expect(selected()).toBeUndefined();
    const terminal = document.querySelector<HTMLInputElement>("#terminal")!;
    terminal.focus();
    await press("Escape");
    await press("Escape");
    expect(document.activeElement).toBe(document.body);
    await move("ArrowLeft");
    expect(selected()).toBe("conversation");
  });

  it("counts consumed input Escape but excludes repeats, intervening input, and expired pairs", async () => {
    using _view = setup();
    using _timers = fakeTimers();
    editor().focus();
    editor().addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    await press("Escape");
    await press("Escape");
    expect(document.activeElement).toBe(document.body);
    editor().focus();
    await press("x");
    await press("Escape");
    await press("Escape", { repeat: true });
    expect(document.activeElement).toBe(editor());
    vi.advanceTimersByTime(501);
    await press("Escape");
    expect(document.activeElement).toBe(editor());
    await press("Escape");
    expect(document.activeElement).toBe(document.body);
  });

  it("leaves popup dismissal to the popup and clears selection when the user focuses content", async () => {
    using view = setup();
    const popup = document.createElement("div");
    popup.setAttribute("data-slot", "menu-popup");
    popup.setAttribute("data-open", "");
    view.root.append(popup);
    await move("ArrowLeft");
    expect(selected()).toBeUndefined();
    popup.remove();
    await move("ArrowLeft");
    expect(selected()).toBe("chats");
    editor().focus();
    expect(selected()).toBeUndefined();
  });

  it("releases terminal focus before PTY encoding and keeps the first Escape available to the shell", async () => {
    using _view = setup();
    const terminal = document.querySelector<HTMLInputElement>("#terminal")!;
    const sentToShell: string[] = [];
    terminal.addEventListener("keydown", (event) => {
      if (handleContentSectionEscape(event)) return;
      sentToShell.push(event.key);
      event.preventDefault();
      event.stopPropagation();
    });
    terminal.focus();
    await press("Escape");
    expect(document.activeElement).toBe(terminal);
    await press("Escape");
    expect(sentToShell).toEqual(["Escape"]);
    expect(document.activeElement).toBe(document.body);
    expect(sectionNavigationOwnsFocus()).toBe(true);
    await move("ArrowLeft");
    await press("Enter");
    expect(document.activeElement).toBe(editor());
    expect(sectionNavigationOwnsFocus()).toBe(false);
  });

  it("clears the contenteditable selection so native editing commands cannot restore its focus", async () => {
    using _view = setup();
    const rich = document.createElement("div");
    rich.contentEditable = "true";
    rich.setAttribute("contenteditable", "true");
    rich.tabIndex = 0;
    rich.textContent = "Rich draft";
    document.querySelector("main")!.append(rich);
    rich.focus();
    const range = document.createRange();
    range.selectNodeContents(rich);
    document.getSelection()!.addRange(range);
    await press("Escape");
    await press("Escape");
    expect(document.getSelection()!.rangeCount).toBe(0);
    expect(rich.textContent).toBe("Rich draft");
  });

  it("does not let a mounted closed menu block navigation and consumes selected Escape", async () => {
    using view = setup();
    view.root.insertAdjacentHTML("beforeend", '<div data-slot="menu-popup"></div>');
    await move("ArrowRight");
    expect(selected()).toBe("surfaces");
    const event = await press("Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(selected()).toBe("surfaces");
    await press("Escape");
    expect(selected()).toBeUndefined();
  });

  it("returns a right-panel input to panel navigation and releases the panel on a quick third Escape", async () => {
    using _view = setup();
    const input = document.querySelector<HTMLInputElement>("#terminal")!;
    input.value = "unfinished command";
    input.focus();
    await press("Escape");
    expect(document.activeElement).toBe(input);
    await press("Escape");
    expect(document.activeElement).toBe(document.body);
    expect(input.value).toBe("unfinished command");
    expect(selected()).toBe("surfaces");
    await press("Escape");
    expect(selected()).toBeUndefined();
  });

  it("requires a fresh pair after the continuing third-Escape window expires or another key intervenes", async () => {
    using _view = setup();
    using _timers = fakeTimers();
    const input = document.querySelector<HTMLInputElement>("#terminal")!;
    for (const interrupt of [() => vi.advanceTimersByTime(501), () => press("x")]) {
      input.focus();
      await press("Escape");
      await press("Escape");
      expect(selected()).toBe("surfaces");
      await interrupt();
      await press("Escape");
      expect(selected()).toBe("surfaces");
      await press("Escape");
      expect(selected()).toBeUndefined();
    }
  });

  it("counts input suggestion dismissal toward the pair without dismissing an independent menu", async () => {
    using view = setup();
    const input = document.querySelector<HTMLInputElement>("#terminal")!;
    input.focus();
    view.root.insertAdjacentHTML("beforeend", '<div data-slot="combobox-popup" data-open></div>');
    input.addEventListener(
      "keydown",
      (event) => {
        document.querySelector('[data-slot="combobox-popup"]')!.remove();
        event.preventDefault();
        event.stopPropagation();
      },
      { once: true },
    );
    await press("Escape");
    await press("Escape");
    expect(selected()).toBe("surfaces");
    view.root.insertAdjacentHTML("beforeend", '<div data-slot="menu-popup" data-open></div>');
    await press("Escape");
    expect(selected()).toBe("surfaces");
    document.querySelector('[data-slot="menu-popup"]')!.remove();
    await press("Escape");
    expect(selected()).toBe("surfaces");
    await press("Escape");
    expect(selected()).toBeUndefined();
  });

  it("continues the Escape sequence after focus transfers out of an embedded browser", async () => {
    using _view = setup();
    using _timers = fakeTimers();
    await move("ArrowRight");
    const guest = document.createElement("webview");
    guest.tabIndex = 0;
    document.querySelector('[data-navigation-section="surfaces"]')!.append(guest);
    guest.focus();
    releaseBrowserSectionFocus();
    expect(document.activeElement).toBe(document.body);
    expect(selected()).toBe("surfaces");
    vi.advanceTimersByTime(400);
    await press("Escape");
    expect(selected()).toBeUndefined();
  });

  it("includes visible drafts in the same traversal order as saved chats", async () => {
    using _view = setup();
    document
      .querySelector("aside")!
      .insertAdjacentHTML(
        "afterbegin",
        '<div data-navigation-chat role="button" tabindex="0" id="draft">Draft</div>',
      );
    document.querySelector("#first")!.removeAttribute("aria-current");
    await move("ArrowLeft");
    expect(highlighted()).toBe("draft");
    await press("ArrowDown");
    expect(highlighted()).toBe("first");
  });

  it("uses Ctrl on Windows and removes all selection treatment on cleanup", async () => {
    using view = setup("Win32");
    await move("ArrowLeft");
    expect(selected()).toBeUndefined();
    await press("ArrowLeft", { ctrlKey: true });
    expect(selected()).toBe("chats");
    view.uninstall();
    expect(selected()).toBeUndefined();
    expect(document.querySelector("[data-section-highlight]")).toBeNull();
  });
});
