/** Input Escape remains an escape hatch even when page suggestions consume it. */
export function createSectionEscapeHandler(release: () => void) {
  let previous: number | null = null;
  return (
    event: Pick<
      KeyboardEvent,
      | "key"
      | "repeat"
      | "isComposing"
      | "defaultPrevented"
      | "metaKey"
      | "ctrlKey"
      | "altKey"
      | "shiftKey"
    > & { inputFocused?: boolean },
  ) => {
    if (event.repeat) return;
    if (
      event.key !== "Escape" ||
      event.isComposing ||
      (event.defaultPrevented && !event.inputFocused) ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      event.shiftKey
    ) {
      previous = null;
      return;
    }
    const now = performance.now();
    if (previous !== null && now - previous <= 500) {
      previous = null;
      release();
    } else {
      previous = now;
    }
  };
}
