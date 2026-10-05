import type { Session, WebContents } from "electron";

export function isLinearNavigationUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      !url.username &&
      !url.password &&
      (url.origin === "https://linear.app" || url.origin === "https://accounts.google.com")
    );
  } catch {
    return false;
  }
}

const guardedSessions = new WeakMap<Session, Set<number>>();
const guardedContents = new WeakSet<WebContents>();

/** Install before the first load, including for OAuth popups. Assets remain unrestricted. */
export function restrictLinearNavigation(contents: WebContents): void {
  if (guardedContents.has(contents)) return;
  guardedContents.add(contents);
  const session = contents.session;
  const webContentsId = contents.id;
  let ids = guardedSessions.get(session);
  if (!ids) {
    ids = new Set();
    guardedSessions.set(session, ids);
    const restrictedIds = ids;
    // Electron supports one listener per session. This is the preview session's
    // sole onBeforeRequest owner; normal Browser tabs in the same profile pass through.
    session.webRequest.onBeforeRequest((details, callback) => {
      callback({
        cancel:
          details.resourceType === "mainFrame" &&
          details.webContentsId !== undefined &&
          restrictedIds.has(details.webContentsId) &&
          !isLinearNavigationUrl(details.url),
      });
    });
  }
  ids.add(webContentsId);
  // Also reject non-network destinations (data:, file:, javascript:, etc.).
  const preventNavigation = (event: Electron.Event, url: string) => {
    if (!isLinearNavigationUrl(url)) event.preventDefault();
  };
  contents.on("will-navigate", preventNavigation);
  contents.on("will-redirect", (event, url, _inPlace, isMainFrame) => {
    if (isMainFrame) preventNavigation(event, url);
  });
  contents.once("destroyed", () => {
    ids.delete(webContentsId);
    if (ids.size === 0) {
      session.webRequest.onBeforeRequest(null);
      guardedSessions.delete(session);
    }
  });
}
