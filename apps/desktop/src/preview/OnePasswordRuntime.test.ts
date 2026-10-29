import * as NodeEvents from "node:events";
import type { Session } from "electron";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { loadOnePassword } from "./OnePasswordRuntime.ts";
import { ONE_PASSWORD_EXTENSION_ID, ONE_PASSWORD_ORIGIN } from "./OnePasswordFiles.ts";

const fixture = () => {
  const workers = Object.assign(new NodeEvents.EventEmitter(), {
    getWorkerFromVersionID: (version: number) => ({
      scope: version === 1 ? `${ONE_PASSWORD_ORIGIN}/` : "https://example.com/",
    }),
  });
  const loaded = Promise.withResolvers<{ id: string }>();
  const extensions = { loadExtension: vi.fn(() => loaded.promise), removeExtension: vi.fn() };
  const session = { serviceWorkers: workers, extensions } as unknown as Session;
  return { session, workers, extensions, loaded };
};
afterEach(() => vi.useRealTimers());

describe("1Password background startup", () => {
  it("waits for its background worker, not merely package loading or another origin's worker", async () => {
    const f = fixture();
    let finished = false;
    const pending = loadOnePassword(f.session, "/extension").then(() => {
      finished = true;
    });
    f.loaded.resolve({ id: ONE_PASSWORD_EXTENSION_ID });
    f.workers.emit("running-status-changed", { versionId: 2, runningStatus: "running" });
    await Promise.resolve();
    expect(finished).toBe(false);
    f.workers.emit("running-status-changed", { versionId: 1, runningStatus: "running" });
    await pending;
    expect(f.workers.listenerCount("running-status-changed")).toBe(0);
  });
  it("unloads an unexpected extension identity without waiting for its worker", async () => {
    const f = fixture();
    const pending = loadOnePassword(f.session, "/extension");
    f.loaded.resolve({ id: "another-extension" });
    await expect(pending).rejects.toThrow("Unexpected 1Password extension identity");
    expect(f.extensions.removeExtension).toHaveBeenCalledWith("another-extension");
    expect(f.workers.listenerCount("running-status-changed")).toBe(0);
  });
  it("removes a failed package and releases listeners", async () => {
    const f = fixture();
    const pending = loadOnePassword(f.session, "/extension");
    f.loaded.reject(new Error("load failed"));
    await expect(pending).rejects.toThrow("load failed");
    expect(f.extensions.removeExtension).toHaveBeenCalledWith(ONE_PASSWORD_EXTENSION_ID);
    expect(f.workers.listenerCount("running-status-changed")).toBe(0);
  });
  it("fails and removes a package whose background never starts", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.loaded.resolve({ id: ONE_PASSWORD_EXTENSION_ID });
    const pending = expect(loadOnePassword(f.session, "/extension")).rejects.toThrow(
      "background process did not start",
    );
    await vi.advanceTimersByTimeAsync(10_000);
    await pending;
    expect(f.extensions.removeExtension).toHaveBeenCalledWith(ONE_PASSWORD_EXTENSION_ID);
    expect(f.workers.listenerCount("running-status-changed")).toBe(0);
  });
});
