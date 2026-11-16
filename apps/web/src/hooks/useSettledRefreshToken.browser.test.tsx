import { describe, expect, it } from "vite-plus/test";

import { render, type Screen } from "../../test/render";
import { useSettledRefreshToken } from "./useSettledRefreshToken";

function Probe(props: Parameters<typeof useSettledRefreshToken>[0]) {
  const value = useSettledRefreshToken(props);
  return <output>{value === null ? "null" : String(value)}</output>;
}

/** Renders one hook input per call and returns the settled token it shows. */
function settledTokens() {
  let screen: Screen | null = null;
  const next = async (
    refreshToken: string | number | null,
    isWorking: boolean,
    resourceKey = "env:thread",
  ) => {
    const probe = <Probe {...{ resourceKey, refreshToken, isWorking }} />;
    // A bare hook probe; nothing here navigates.
    if (screen) await screen.rerender(probe);
    else screen = await render(probe, { router: false });
    return screen.container.textContent;
  };
  return Object.assign(next, {
    async [Symbol.asyncDispose]() {
      await screen?.[Symbol.asyncDispose]();
    },
  });
}

describe("settled refresh tokens", () => {
  it("holds numeric PR refreshes until work stops", async () => {
    await using settle = settledTokens();
    expect(await settle(0, false)).toBe("0");
    expect(await settle(1, true)).toBe("0");
    expect(await settle(5, true)).toBe("0");
    expect(await settle(5, false)).toBe("5");
  });

  it("holds the current preview through commands and file changes, then adopts the latest", async () => {
    await using settle = settledTokens();
    expect(await settle("before-turn", false)).toBe("before-turn");
    expect(await settle("before-turn", true)).toBe("before-turn");
    expect(await settle("command-1", true)).toBe("before-turn");
    expect(await settle("file-change-2", true)).toBe("before-turn");
    expect(await settle("command-3", true)).toBe("before-turn");
    expect(await settle("command-3", false)).toBe("command-3");
    expect(await settle("checkpoint", false)).toBe("checkpoint");
  });

  it("keeps a first-turn preview stable when there was no earlier mutation", async () => {
    await using settle = settledTokens();
    expect(await settle(null, false)).toBe("null");
    expect(await settle("first-command", true)).toBe("null");
    expect(await settle("last-command", true)).toBe("null");
    expect(await settle("last-command", false)).toBe("last-command");
  });

  it("catches up when work stops without a completed checkpoint", async () => {
    await using settle = settledTokens();
    await settle("before-turn", false);
    expect(await settle("changed-before-stop", true)).toBe("before-turn");
    expect(await settle("changed-before-stop", false)).toBe("changed-before-stop");
    expect(await settle("next-turn-command", true)).toBe("changed-before-stop");
  });

  it("initializes a running thread from its current files", async () => {
    await using settle = settledTokens();
    expect(await settle("already-running", true)).toBe("already-running");
    expect(await settle("next-command", true)).toBe("already-running");
  });

  it("never carries a frozen revision into a different thread or environment", async () => {
    await using settle = settledTokens();
    await settle("thread-a-old", false);
    await settle("thread-a-new", true);
    expect(await settle("thread-b-current", true, "env:thread-b")).toBe("thread-b-current");
    expect(await settle(null, true, "other-env:thread-b")).toBe("null");
    expect(await settle("other-env-command", true, "other-env:thread-b")).toBe("null");
    expect(await settle("other-env-command", false, "other-env:thread-b")).toBe(
      "other-env-command",
    );
  });
});
