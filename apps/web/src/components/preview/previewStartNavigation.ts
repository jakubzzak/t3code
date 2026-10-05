import type { KeyboardEvent } from "react";

/** Navigate the URL and start-screen choices without visiting browser toolbar controls. */
export function handlePreviewStartNavigation(event: KeyboardEvent<HTMLElement>) {
  if (
    event.defaultPrevented ||
    event.nativeEvent.isComposing ||
    event.altKey ||
    event.metaKey ||
    event.ctrlKey
  )
    return;
  if (event.key !== "Tab" && event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  if (event.shiftKey && event.key !== "Tab") return;
  const controls = [
    ...event.currentTarget.querySelectorAll<HTMLElement>(
      "[data-preview-url-input], [data-preview-start-list] button:not(:disabled)",
    ),
  ].filter((node) => !node.closest('[hidden], [inert], [aria-hidden="true"]'));
  const index = controls.indexOf(document.activeElement as HTMLElement);
  if (index < 0) return;
  const nextIndex = index + (event.key === "ArrowUp" || event.shiftKey ? -1 : 1);
  if (event.key === "Tab" && (nextIndex < 0 || nextIndex >= controls.length)) return;
  event.preventDefault();
  controls[Math.max(0, Math.min(controls.length - 1, nextIndex))]?.focus();
}
