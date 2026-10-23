import { observeResize } from "~/lib/observeResize";

/** Keep a short card fully visible, or the start of a tall card visible. */
export function inboxFocusScrollDelta(
  rowTop: number,
  rowBottom: number,
  viewTop: number,
  viewBottom: number,
) {
  const top = viewTop + 8;
  const bottom = viewBottom - 8;
  if (rowBottom - rowTop > bottom - top)
    return rowTop < top || rowTop > bottom ? Math.round(rowTop - top) : 0;
  if (rowTop < top) return Math.round(rowTop - top);
  if (rowBottom > bottom) return Math.round(rowBottom - bottom);
  return 0;
}

/** Track only the focus transition, including asynchronous detail arrival, not the user's later reading scroll. */
export function keepInboxRowVisible(row: HTMLElement) {
  const list = row.closest<HTMLElement>("[data-inbox-list]");
  const viewport = row.closest<HTMLElement>('[data-slot="sidebar-content"]');
  if (!list || !viewport) return () => {};
  let frame: number | undefined;
  const adjust = () => {
    const box = row.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    const delta = inboxFocusScrollDelta(box.top, box.bottom, view.top, view.bottom);
    if (delta) viewport.scrollTop += delta;
  };
  const schedule = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(adjust);
  };
  const stopResize = observeResize([list, row], schedule);
  list.addEventListener("transitionend", schedule);
  const stop = () => {
    stopResize();
    list.removeEventListener("transitionend", schedule);
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
  // Both list movement and row expansion finish within 220 ms. No idle animation loop.
  const timer = window.setTimeout(() => {
    adjust();
    stop();
  }, 250);
  adjust();
  return () => {
    window.clearTimeout(timer);
    stop();
  };
}
