import { isContextMenuOpen } from "./contextMenuFallback";
import { isMacPlatform } from "./lib/utils";

export type NavigationSection = "chats" | "conversation" | "surfaces";
const sections: readonly NavigationSection[] = ["chats", "conversation", "surfaces"];
const popupSelector = [
  '[role="dialog"][aria-modal="true"]',
  ...[
    "dialog",
    "alert-dialog",
    "command-dialog",
    "menu",
    "select",
    "popover",
    "combobox",
    "autocomplete",
  ].map((slot) => `[data-slot="${slot}-popup"]:is([data-open],[data-ending-style])`),
].join(",");

export function isSectionNavigationBlocked(allowInputSuggestions = false) {
  if (isContextMenuOpen()) return true;
  const inputFocused = document.activeElement?.matches(
    'input, textarea, select, [contenteditable]:not([contenteditable="false"])',
  );
  return [...document.querySelectorAll(popupSelector)].some(
    (popup) =>
      !(
        allowInputSuggestions &&
        inputFocused &&
        popup.matches(
          '[data-slot="combobox-popup"], [data-slot="autocomplete-popup"], [role="listbox"]',
        )
      ),
  );
}

export function selectedNavigationSection(): NavigationSection | null {
  if (typeof document === "undefined") return null;
  const value = document.documentElement.dataset.selectedSection;
  return sections.find((section) => section === value) ?? null;
}

export function sectionNavigationOwnsFocus() {
  return (
    typeof document !== "undefined" &&
    (selectedNavigationSection() !== null ||
      document.documentElement.hasAttribute("data-section-unfocused"))
  );
}

export function clearSectionSelection() {
  delete document.documentElement.dataset.selectedSection;
  document
    .querySelectorAll("[data-section-highlight]")
    .forEach((node) => node.removeAttribute("data-section-highlight"));
}

let terminalEscape: ((event: KeyboardEvent) => boolean) | undefined;
let releaseGuestFocus: (() => void) | undefined;

/** Keep keyboard navigation on the panel after a view or its creation menu changes. */
export function focusRightPanel() {
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  document.getSelection()?.removeAllRanges();
  clearSectionSelection();
  document.documentElement.removeAttribute("data-section-unfocused");
  document.documentElement.dataset.selectedSection = "surfaces";
}

/** Called after contextual handlers, before an editor or terminal consumes an unused Escape. */
export function handleContentSectionEscape(event: KeyboardEvent): boolean {
  return terminalEscape?.(event) ?? false;
}

/** The guest preload has already checked the double-Escape gesture. */
export function releaseBrowserSectionFocus() {
  releaseGuestFocus?.();
}

function sectionOf(target: EventTarget | null): NavigationSection | null {
  if (!(target instanceof Element)) return null;
  if (target.closest("[data-preview-viewport]")) return "surfaces";
  const section = target.closest<HTMLElement>("[data-navigation-section]")?.dataset
    .navigationSection;
  return sections.find((value) => value === section) ?? null;
}

function contentOwnsFocus() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || active === document.body) return false;
  return (
    sectionOf(active) === "surfaces" ||
    active.matches("webview") ||
    active.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-terminal-owner]',
    ) !== null
  );
}

function visibleChatRows() {
  return [
    ...document.querySelectorAll<HTMLElement>(
      '[data-navigation-section="chats"] [data-navigation-chat]',
    ),
  ].filter((row) => {
    for (let node: HTMLElement | null = row; node; node = node.parentElement) {
      if (node.hidden || node.inert || getComputedStyle(node).display === "none") return false;
    }
    return true;
  });
}

/** Mounted only by a wide chat view. DOM focus and transient highlights stay local to this client. */
export function installSectionNavigation(options: {
  platform: string;
  reveal: (section: NavigationSection) => void;
  focusComposer: () => void;
}) {
  let lastSection = sectionOf(document.activeElement) ?? "conversation";
  let lastEscape: number | null = null;
  let focusedTarget: EventTarget | null = document.activeElement;
  let movingHighlight = false;
  const processedEscapes = new WeakMap<KeyboardEvent, boolean>();
  const blocked = isSectionNavigationBlocked;
  const blur = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.getSelection()?.removeAllRanges();
  };
  const release = () => {
    lastSection = sectionOf(document.activeElement) ?? lastSection;
    lastEscape = null;
    clearSectionSelection();
    document.documentElement.setAttribute("data-section-unfocused", "");
    blur();
  };
  const highlight = (row: HTMLElement | undefined) => {
    document
      .querySelectorAll("[data-section-highlight]")
      .forEach((node) => node.removeAttribute("data-section-highlight"));
    if (!row) return;
    row.setAttribute("data-section-highlight", "");
    movingHighlight = true;
    row.focus({ preventScroll: true });
    movingHighlight = false;
    row.scrollIntoView?.({ block: "nearest" });
  };
  const escape = (event: KeyboardEvent) => {
    if (event.repeat) return false;
    if (
      event.key !== "Escape" ||
      event.isComposing ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    ) {
      lastEscape = null;
      return false;
    }
    if (event.defaultPrevented || blocked(true)) {
      lastEscape = null;
      return false;
    }
    const selected = selectedNavigationSection();
    if (selected && selected !== "surfaces") {
      release();
      return true;
    }
    if (!selected && !contentOwnsFocus()) return false;
    const now = performance.now();
    if (lastEscape !== null && now - lastEscape <= 500) {
      if (!selected && sectionOf(document.activeElement) === "surfaces") {
        lastSection = "surfaces";
        focusRightPanel();
        lastEscape = now;
      } else {
        release();
      }
      return true;
    }
    lastEscape = now;
    return selected === "surfaces";
  };
  const processEscape = (event: KeyboardEvent) => {
    const processed = processedEscapes.get(event);
    if (processed !== undefined) return processed;
    const handled = escape(event);
    processedEscapes.set(event, handled);
    if (!handled) return false;
    event.preventDefault();
    event.stopPropagation();
    return true;
  };
  const onTerminalEscape = (event: KeyboardEvent) => processEscape(event);
  const onGuestRelease = () => {
    if (blocked()) return;
    lastSection = "surfaces";
    focusRightPanel();
    lastEscape = performance.now();
  };
  terminalEscape = onTerminalEscape;
  releaseGuestFocus = onGuestRelease;
  const onFocus = (event: FocusEvent) => {
    const sameTarget = event.target === focusedTarget;
    focusedTarget = event.target;
    if (movingHighlight) return;
    document.documentElement.removeAttribute("data-section-unfocused");
    if (sameTarget) return;
    const section = sectionOf(event.target);
    if (section) lastSection = section;
    lastEscape = null;
    if (
      section === "surfaces" &&
      selectedNavigationSection() === "surfaces" &&
      event.target instanceof Element &&
      !event.target.closest(
        'input, textarea, select, webview, [contenteditable]:not([contenteditable="false"]), [data-terminal-owner]',
      )
    )
      return;
    clearSectionSelection();
  };
  const onPointer = (event: PointerEvent) => {
    document.documentElement.removeAttribute("data-section-unfocused");
    lastSection = sectionOf(event.target) ?? lastSection;
    lastEscape = null;
    clearSectionSelection();
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      // Count before input handlers dismiss suggestions or a terminal consumes
      // the first Escape. Independent menus/dialogs still block this gesture.
      processEscape(event);
      return;
    }
    lastEscape = null;
    if (event.defaultPrevented || event.isComposing || blocked()) return;
    const selected = selectedNavigationSection();
    const modifier = isMacPlatform(options.platform)
      ? event.metaKey && !event.ctrlKey
      : event.ctrlKey && !event.metaKey;
    if (
      modifier &&
      !event.altKey &&
      !event.shiftKey &&
      (event.key === "ArrowLeft" || event.key === "ArrowRight")
    ) {
      if (!selected && contentOwnsFocus()) return;
      event.preventDefault();
      event.stopPropagation();
      const index = sections.indexOf(selected ?? lastSection);
      const next =
        sections[Math.max(0, Math.min(2, index + (event.key === "ArrowLeft" ? -1 : 1)))]!;
      if (selected === next) return;
      clearSectionSelection();
      blur();
      lastSection = next;
      document.documentElement.dataset.selectedSection = next;
      options.reveal(next);
      if (next === "chats") {
        const rows = visibleChatRows();
        highlight(
          rows.find((row) =>
            row.matches('[aria-current="page"], [aria-current="true"], [data-active="true"]'),
          ) ?? rows[0],
        );
      }
      return;
    }
    if (!selected || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    if (selected === "chats" && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      event.stopPropagation();
      const rows = visibleChatRows();
      const index = rows.findIndex((row) => row.hasAttribute("data-section-highlight"));
      highlight(
        rows[Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))],
      );
    } else if (event.key === "Enter" && selected !== "surfaces") {
      event.preventDefault();
      event.stopPropagation();
      const row = document.querySelector<HTMLElement>("[data-section-highlight]");
      clearSectionSelection();
      if (selected === "chats") row?.click();
      options.focusComposer();
    }
  };
  window.addEventListener("keydown", onKey, true);
  document.addEventListener("focusin", onFocus);
  document.addEventListener("pointerdown", onPointer, true);
  return () => {
    document.documentElement.removeAttribute("data-section-unfocused");
    window.removeEventListener("keydown", onKey, true);
    document.removeEventListener("focusin", onFocus);
    document.removeEventListener("pointerdown", onPointer, true);
    if (terminalEscape === onTerminalEscape) terminalEscape = undefined;
    if (releaseGuestFocus === onGuestRelease) releaseGuestFocus = undefined;
    clearSectionSelection();
  };
}
