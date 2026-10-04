// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  installSectionNavigation,
  handleContentSectionEscape,
  sectionNavigationOwnsFocus,
} from "./sectionNavigation";

let cleanup = () => {};
let reveal = vi.fn();
let focusComposer = vi.fn();
const selected = () => document.documentElement.dataset.selectedSection;
const editor = () => document.querySelector<HTMLTextAreaElement>("#composer")!;
async function press(key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...options });
  document.activeElement!.dispatchEvent(event);
  await Promise.resolve();
  return event;
}
const move = (key: string) => press(key, { metaKey: true });

beforeEach(() => {
  document.body.innerHTML = `
    <aside data-navigation-section="chats">
      <div data-thread-item><button data-navigation-chat id="first" aria-current="page">First chat</button></div>
      <div data-thread-item><button data-navigation-chat id="second">Second chat</button></div>
      <div hidden><div data-thread-item><button data-navigation-chat id="hidden">Collapsed chat</button></div></div>
    </aside>
    <main data-navigation-section="conversation"><textarea id="composer">Unsent draft</textarea></main>
    <aside data-navigation-section="surfaces"><input id="terminal" data-terminal-owner="right-panel"></aside>`;
  reveal = vi.fn();
  focusComposer = vi.fn(() => editor().focus());
  cleanup = installSectionNavigation({ platform: "MacIntel", reveal, focusComposer });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("keyboard section navigation", () => {
  it("releases a draft with double Escape, previews chats without opening, and enters the highlight", async () => {
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
    expect(reveal).toHaveBeenCalledWith("chats");
    expect(document.querySelector("[data-section-highlight]")?.id).toBe("first");
    document.activeElement!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    await press("ArrowDown");
    expect(document.querySelector("[data-section-highlight]")?.id).toBe("second");
    await press("ArrowDown");
    expect(document.querySelector("[data-section-highlight]")?.id).toBe("second");
    await move("ArrowLeft");
    expect(document.querySelector("[data-section-highlight]")?.id).toBe("second");
    expect(opened).not.toHaveBeenCalled();
    await press("Enter");
    expect(opened).toHaveBeenCalledOnce();
    expect(selected()).toBeUndefined();
    expect(focusComposer).toHaveBeenCalledOnce();
  });

  it("starts from center, reveals the right panel, clamps edges, and escapes without refocusing", async () => {
    await move("ArrowRight");
    expect(selected()).toBe("surfaces");
    expect(reveal).toHaveBeenCalledWith("surfaces");
    await move("ArrowRight");
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

  it("excludes consumed Escape, repeated keys, intervening input, and expired pairs", async () => {
    vi.useFakeTimers();
    editor().focus();
    editor().addEventListener("keydown", (event) => event.preventDefault(), { once: true });
    await press("Escape");
    await press("Escape");
    expect(document.activeElement).toBe(editor());
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
    const popup = document.createElement("div");
    popup.setAttribute("data-slot", "menu-popup");
    popup.setAttribute("data-open", "");
    document.body.append(popup);
    await move("ArrowLeft");
    expect(selected()).toBeUndefined();
    popup.remove();
    await move("ArrowLeft");
    expect(selected()).toBe("chats");
    editor().focus();
    expect(selected()).toBeUndefined();
  });

  it("releases terminal focus before PTY encoding and keeps the first Escape available to the shell", async () => {
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
    document.body.insertAdjacentHTML("beforeend", '<div data-slot="menu-popup"></div>');
    await move("ArrowRight");
    expect(selected()).toBe("surfaces");
    const event = await press("Escape");
    expect(event.defaultPrevented).toBe(true);
    expect(selected()).toBeUndefined();
  });

  it("includes visible drafts in the same traversal order as saved chats", async () => {
    document
      .querySelector("aside")!
      .insertAdjacentHTML(
        "afterbegin",
        '<div data-navigation-chat role="button" tabindex="0" id="draft">Draft</div>',
      );
    document.querySelector("#first")!.removeAttribute("aria-current");
    await move("ArrowLeft");
    expect(document.querySelector("[data-section-highlight]")?.id).toBe("draft");
    await press("ArrowDown");
    expect(document.querySelector("[data-section-highlight]")?.id).toBe("first");
  });

  it("uses Ctrl on Windows and removes all selection treatment on cleanup", async () => {
    cleanup();
    cleanup = installSectionNavigation({ platform: "Win32", reveal, focusComposer });
    await move("ArrowLeft");
    expect(selected()).toBeUndefined();
    await press("ArrowLeft", { ctrlKey: true });
    expect(selected()).toBe("chats");
    cleanup();
    expect(selected()).toBeUndefined();
    expect(document.querySelector("[data-section-highlight]")).toBeNull();
  });
});
