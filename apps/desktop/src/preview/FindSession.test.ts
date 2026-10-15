import * as NodeEvents from "node:events";
import { describe, expect, it, vi } from "vite-plus/test";
import { createFindSession } from "./FindSession.ts";

function fixture() {
  const contents = Object.assign(new NodeEvents.EventEmitter(), {
    findInPage: vi.fn().mockReturnValueOnce(1).mockReturnValueOnce(2),
    stopFindInPage: vi.fn(),
  });
  const session = createFindSession(contents as never);
  const result = (requestId: number, matches: number, finalUpdate = true) =>
    contents.emit(
      "found-in-page",
      {},
      { requestId, matches, activeMatchOrdinal: matches ? 1 : 0, finalUpdate },
    );
  return { contents, session, result };
}
const options = { forward: true, findNext: false };

describe("page Find", () => {
  it("returns only the final matching Chromium search result", async () => {
    const { contents, session, result } = fixture();
    const search = session.find("phrase", options);
    expect(contents.findInPage).toHaveBeenCalledWith("phrase", options);
    result(99, 8);
    result(1, 1, false);
    result(1, 3);
    await expect(search).resolves.toEqual({ matches: 3, activeMatchOrdinal: 1 });
    session.dispose();
    expect(contents.listenerCount("found-in-page")).toBe(0);
  });
  it("cancels replaced queries and clears results on navigation and close", async () => {
    const { contents, session, result } = fixture();
    const first = session.find("old", options);
    const second = session.find("new", { forward: false, findNext: true });
    await expect(first).resolves.toBeNull();
    result(1, 9);
    contents.emit("did-start-navigation", { isMainFrame: true });
    await expect(second).resolves.toBeNull();
    expect(contents.stopFindInPage).toHaveBeenCalledWith("clearSelection");
    session.dispose();
  });
  it("clears an empty query without asking Chromium to search it", async () => {
    const { contents, session } = fixture();
    await expect(session.find("", options)).resolves.toBeNull();
    expect(contents.findInPage).not.toHaveBeenCalled();
    expect(contents.stopFindInPage).toHaveBeenCalledWith("clearSelection");
    session.dispose();
  });
});
