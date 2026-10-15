import type { DesktopPreviewFindResult } from "@t3tools/contracts";

/** Owns the outstanding Chromium search for one guest. */
export function createFindSession(
  contents: Pick<Electron.WebContents, "findInPage" | "stopFindInPage" | "on" | "off">,
) {
  let pending:
    | { id: number; resolve: (result: DesktopPreviewFindResult | null) => void }
    | undefined;
  const cancel = () => {
    pending?.resolve(null);
    pending = undefined;
  };
  const stop = () => {
    cancel();
    contents.stopFindInPage("clearSelection");
  };
  const found = (_event: Electron.Event, result: Electron.Result) => {
    if (!pending || result.requestId !== pending.id || !result.finalUpdate) return;
    pending.resolve({ matches: result.matches, activeMatchOrdinal: result.activeMatchOrdinal });
    pending = undefined;
  };
  const navigating = (event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>) => {
    if (event.isMainFrame) stop();
  };
  contents.on("found-in-page", found);
  contents.on("did-start-navigation", navigating);
  contents.on("destroyed", cancel);
  return {
    find: (
      text: string,
      options: { forward: boolean; findNext: boolean },
    ): Promise<DesktopPreviewFindResult | null> => {
      cancel();
      if (!text) {
        stop();
        return Promise.resolve(null);
      }
      return new Promise((resolve) => {
        pending = { id: contents.findInPage(text, options), resolve };
      });
    },
    stop,
    dispose: () => {
      cancel();
      contents.off("found-in-page", found);
      contents.off("did-start-navigation", navigating);
      contents.off("destroyed", cancel);
    },
  };
}
