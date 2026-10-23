import { observeResize } from "~/lib/observeResize";

/** Bring an obscured notification's header to the top, leaving visible cards in place. */
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
  if (rowBottom > bottom) return Math.round(rowTop - top);
  return 0;
}

/** Track only the focus transition, including asynchronous detail arrival, not the user's later reading scroll. */
export function keepInboxRowVisible(row: HTMLElement) {
  const list = row.closest<HTMLElement>("[data-inbox-list]");
  const viewport = row.closest<HTMLElement>('[data-slot="scroll-area-viewport"]');
  if (!list || !viewport) return () => {};
  let frame: number | undefined;
  let target: number | undefined;
  let scrolling = false;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const completed = () => {
    scrolling = false;
  };
  viewport.addEventListener("scrollend", completed);
  const adjust = () => {
    const box = row.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    const delta = inboxFocusScrollDelta(box.top, box.bottom, view.top, view.bottom);
    if (!delta && target === undefined) return;
    // Keep one destination through native scroll frames, retargeting only when layout moves it.
    const next = Math.max(0, Math.round(viewport.scrollTop + box.top - view.top - 8));
    if (target !== undefined && Math.abs(next - target) < 1) return;
    target = next;
    scrolling = !reducedMotion;
    viewport.scrollTo({ top: next, behavior: reducedMotion ? "instant" : "smooth" });
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
    viewport.removeEventListener("scrollend", completed);
    // A new focus must not inherit the previous notification's unfinished scroll.
    if (scrolling) viewport.scrollTo({ top: viewport.scrollTop, behavior: "instant" });
  };
}
