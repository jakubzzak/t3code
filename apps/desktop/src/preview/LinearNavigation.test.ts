import * as NodeEvents from "node:events";
import type { Session, WebContents } from "electron";
import { describe, expect, it, vi } from "vite-plus/test";
import { isLinearNavigationUrl, restrictLinearNavigation } from "./LinearNavigation.ts";

type Request = { url: string; resourceType: string; webContentsId?: number };
type RequestListener = (details: Request, callback: (result: { cancel?: boolean }) => void) => void;
function fixture() {
  let listener: RequestListener | null = null;
  const session = {
    webRequest: {
      onBeforeRequest: vi.fn((next: RequestListener | null) => {
        listener = next;
      }),
    },
  };
  const guest = (id: number) =>
    Object.assign(new NodeEvents.EventEmitter(), { id, session: session as unknown as Session });
  const request = (id: number, url: string, resourceType = "mainFrame") => {
    const callback = vi.fn();
    listener?.({ webContentsId: id, url, resourceType }, callback);
    return callback.mock.calls[0]?.[0].cancel;
  };
  return { guest, request, session };
}

describe("Linear native navigation policy", () => {
  it.each([
    "https://linear.app/acme/issue/ENG-1",
    "https://accounts.google.com/v3/signin/identifier",
  ])("allows %s", (url) => {
    expect(isLinearNavigationUrl(url)).toBe(true);
  });
  it.each([
    "https://evil.test",
    "https://linear.app.evil.test",
    "https://linear.app:444",
    "http://linear.app",
    "https://user@linear.app",
    "data:text/html,evil",
    "file:///tmp/evil",
    "javascript:alert(1)",
    "about:blank",
  ])("rejects %s", (url) => {
    expect(isLinearNavigationUrl(url)).toBe(false);
  });
  it("blocks programmatic requests/redirects only for restricted guests, preserving assets and ordinary Browser tabs", () => {
    const { guest, request, session } = fixture();
    const first = guest(1);
    const second = guest(2);
    restrictLinearNavigation(first as unknown as WebContents);
    restrictLinearNavigation(second as unknown as WebContents);
    expect(session.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
    expect(request(1, "https://linear.app/acme")).toBe(false);
    expect(request(1, "https://evil.test/redirect")).toBe(true);
    expect(request(2, "https://evil.test")).toBe(true);
    expect(request(3, "https://evil.test")).toBe(false);
    expect(request(1, "https://cdn.example/image.png", "image")).toBe(false);
    first.emit("destroyed");
    expect(request(1, "https://evil.test")).toBe(false);
    expect(request(2, "https://evil.test")).toBe(true);
    second.emit("destroyed");
    expect(session.webRequest.onBeforeRequest).toHaveBeenLastCalledWith(null);
  });
  it("cancels page navigation and main-frame redirects, including non-network schemes", () => {
    const { guest } = fixture();
    const contents = guest(1);
    restrictLinearNavigation(contents as unknown as WebContents);
    const blocked = { preventDefault: vi.fn() };
    contents.emit("will-navigate", blocked, "data:text/html,evil");
    contents.emit("will-redirect", blocked, "https://evil.test", false, true);
    expect(blocked.preventDefault).toHaveBeenCalledTimes(2);
    const allowed = { preventDefault: vi.fn() };
    contents.emit("will-navigate", allowed, "https://accounts.google.com/signin");
    contents.emit("will-redirect", allowed, "https://linear.app/acme", false, true);
    expect(allowed.preventDefault).not.toHaveBeenCalled();
    contents.emit("destroyed");
  });
});
