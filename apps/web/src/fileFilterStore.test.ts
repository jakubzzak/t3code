import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import {
  createFileFilter,
  fileFilterKey,
  selectFileFilter,
  useFileFilterStore,
} from "./fileFilterStore";

const ref = scopeThreadRef(EnvironmentId.make("local"), ThreadId.make("chat"));
const diff = fileFilterKey(ref, "diff");
const pr = fileFilterKey(ref, "pull-request");
const read = (key = diff) => selectFileFilter(useFileFilterStore.getState().filters, key);

beforeEach(() => useFileFilterStore.setState({ filters: {} }));

describe("file filtering", () => {
  it("excludes literal test markers in basenames across extensions", () => {
    const filter = createFileFilter(read().appliedSource);
    const paths = [
      "src/button.spec.ts",
      "button.spec.tsx",
      "server.test.js",
      "button.ts",
      "contest.ts",
      "buttonXspecYts",
      "tests.spec.data/button.ts",
    ];
    expect(paths.filter(filter.matchesPath)).toEqual([
      "button.ts",
      "contest.ts",
      "buttonXspecYts",
      "tests.spec.data/button.ts",
    ]);
  });

  it("isolates both views, chats, and environments, with defaults for new chats", () => {
    useFileFilterStore.getState().edit(diff, "");
    const otherChat = fileFilterKey({ ...ref, threadId: ThreadId.make("other") }, "diff");
    const otherEnvironment = fileFilterKey(
      { ...ref, environmentId: EnvironmentId.make("remote") },
      "diff",
    );
    expect(read().appliedSource).toBe("");
    for (const key of [pr, otherChat, otherEnvironment]) {
      expect(createFileFilter(read(key).appliedSource).matchesPath("app.test.ts")).toBe(false);
    }
  });

  it("keeps the last valid filter on invalid input and can clear it", () => {
    const store = useFileFilterStore.getState();
    store.edit(diff, String.raw`\.tsx?$`);
    store.edit(diff, "[");
    expect(read().invalid).toBe(true);
    expect(read().source).toBe("[");
    expect(createFileFilter(read().appliedSource).matchesPath("app.js")).toBe(false);
    store.edit(diff, "");
    expect(read().invalid).toBe(false);
    expect(createFileFilter(read().appliedSource).matchesPath("app.test.js")).toBe(true);
  });

  it("locks manual edits during generation and applies a valid combined filter", () => {
    const store = useFileFilterStore.getState();
    const before = read().appliedSource;
    const request = store.begin(diff);
    store.edit(diff, "");
    expect(read().appliedSource).toBe(before);
    store.finish(diff, request, { regex: String.raw`^(?!.*\.(spec|test)\.).*\.ts$` });
    expect(read().pending).toBeNull();
    expect(
      ["app.ts", "app.test.ts", "app.js"].filter(
        createFileFilter(read().appliedSource).matchesPath,
      ),
    ).toEqual(["app.ts"]);
  });

  it("cancels work and rejects its late result after a manual edit", () => {
    const store = useFileFilterStore.getState();
    const request = store.begin(diff);
    store.cancel(diff, request);
    expect(request.signal.aborted).toBe(true);
    store.edit(diff, "manual");
    store.finish(diff, request, { regex: "late" });
    expect(read().appliedSource).toBe("manual");
  });

  it("a superseded result cannot unlock or overwrite a newer request", () => {
    const store = useFileFilterStore.getState();
    const first = store.begin(diff);
    const second = store.begin(diff);
    store.finish(diff, first, { regex: "stale" });
    expect(first.signal.aborted).toBe(true);
    expect(read().pending).toBe(second);
    store.finish(diff, second, { error: "Provider unavailable" });
    expect(read().pending).toBeNull();
    expect(read().message).toBe("Provider unavailable");
    expect(createFileFilter(read().appliedSource).matchesPath("app.test.ts")).toBe(false);
  });
});
