/** Run after page handlers so an Escape used to dismiss page UI cannot release the host focus. */
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
    >,
  ) => {
    if (event.repeat) return;
    if (
      event.key !== "Escape" ||
      event.isComposing ||
      event.defaultPrevented ||
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
