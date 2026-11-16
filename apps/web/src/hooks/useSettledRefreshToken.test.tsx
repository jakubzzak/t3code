import { act, useEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { useSettledRefreshToken } from "./useSettledRefreshToken";

let renderer: ReactTestRenderer | null = null;
let revision: string | number | null;

function Probe(props: Parameters<typeof useSettledRefreshToken>[0]) {
  const value = useSettledRefreshToken(props);
  useEffect(() => {
    revision = value;
  }, [value]);
  return null;
}

async function render(
  refreshToken: string | number | null,
  isWorking: boolean,
  resourceKey = "env:thread",
) {
  await act(() => {
    const probe = <Probe {...{ resourceKey, refreshToken, isWorking }} />;
    if (renderer) renderer.update(probe);
    else renderer = create(probe);
  });
  return revision;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  await act(() => renderer?.unmount());
  renderer = null;
  vi.unstubAllGlobals();
});

describe("settled refresh tokens", () => {
  it("holds numeric PR refreshes until work stops", async () => {
    expect(await render(0, false)).toBe(0);
    expect(await render(1, true)).toBe(0);
    expect(await render(5, true)).toBe(0);
    expect(await render(5, false)).toBe(5);
  });
  it("holds the current preview through commands and file changes, then adopts the latest", async () => {
    expect(await render("before-turn", false)).toBe("before-turn");
    expect(await render("before-turn", true)).toBe("before-turn");
    expect(await render("command-1", true)).toBe("before-turn");
    expect(await render("file-change-2", true)).toBe("before-turn");
    expect(await render("command-3", true)).toBe("before-turn");
    expect(await render("command-3", false)).toBe("command-3");
    expect(await render("checkpoint", false)).toBe("checkpoint");
  });

  it("keeps a first-turn preview stable when there was no earlier mutation", async () => {
    expect(await render(null, false)).toBeNull();
    expect(await render("first-command", true)).toBeNull();
    expect(await render("last-command", true)).toBeNull();
    expect(await render("last-command", false)).toBe("last-command");
  });

  it("catches up when work stops without a completed checkpoint", async () => {
    await render("before-turn", false);
    expect(await render("changed-before-stop", true)).toBe("before-turn");
    expect(await render("changed-before-stop", false)).toBe("changed-before-stop");
    expect(await render("next-turn-command", true)).toBe("changed-before-stop");
  });

  it("initializes a running thread from its current files", async () => {
    expect(await render("already-running", true)).toBe("already-running");
    expect(await render("next-command", true)).toBe("already-running");
  });

  it("never carries a frozen revision into a different thread or environment", async () => {
    await render("thread-a-old", false);
    await render("thread-a-new", true);
    expect(await render("thread-b-current", true, "env:thread-b")).toBe("thread-b-current");
    expect(await render(null, true, "other-env:thread-b")).toBeNull();
    expect(await render("other-env-command", true, "other-env:thread-b")).toBeNull();
    expect(await render("other-env-command", false, "other-env:thread-b")).toBe(
      "other-env-command",
    );
  });
});
