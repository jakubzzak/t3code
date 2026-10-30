// @effect-diagnostics globalTimers:off - Vitest advances the browser activity timer deterministically.
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { AutomationActivity } from "./AutomationActivity.ts";

describe("automation rendering lifetime", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("keeps delayed page updates running between tools, then returns to idle", async () => {
    let rendering = false;
    let updated = false;
    const activity = new AutomationActivity(
      async (active) => {
        rendering = active;
      },
      () => {},
    );
    await activity.run(async () => {
      setTimeout(() => {
        updated = rendering;
      }, 100);
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(updated).toBe(true);
    await vi.advanceTimersByTimeAsync(4_000);
    await activity.run(async () => {
      expect(rendering).toBe(true);
    });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(rendering).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(rendering).toBe(false);
  });

  it("does not suspend an overlapping operation when another fails", async () => {
    const apply = vi.fn(async (_active: boolean) => {});
    const activity = new AutomationActivity(apply, () => {});
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const pending = activity.run(async () => {
      started.resolve();
      await gate.promise;
    });
    await started.promise;
    await expect(
      activity.run(async () => {
        throw new Error("page error");
      }),
    ).rejects.toThrow("page error");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(apply.mock.calls).toEqual([[true]]);
    gate.resolve();
    await pending;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(apply.mock.calls).toEqual([[true], [false]]);
  });

  it.each(["reset", "close"] as const)(
    "%s drops demand and ignores late completions",
    async (method) => {
      const apply = vi.fn(async (_active: boolean) => {});
      const activity = new AutomationActivity(apply, () => {});
      const gate = Promise.withResolvers<void>();
      const started = Promise.withResolvers<void>();
      const pending = activity.run(async () => {
        started.resolve();
        await gate.promise;
      });
      await started.promise;
      await activity[method]();
      gate.resolve();
      await pending;
      await vi.advanceTimersByTimeAsync(10_000);
      expect(apply.mock.calls).toEqual([[true], [false]]);
      if (method === "close") await expect(activity.run(async () => {})).rejects.toThrow("closed");
    },
  );

  it("releases cancellation while the underlying page promise is still settling", async () => {
    const apply = vi.fn(async (_active: boolean) => {});
    const activity = new AutomationActivity(apply, () => {});
    const controller = new AbortController();
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const pending = activity.run(async () => {
      started.resolve();
      await gate.promise;
    }, controller.signal);
    await started.promise;
    controller.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect(apply.mock.calls).toEqual([[true], [false]]);
    gate.resolve();
    await pending;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(apply.mock.calls).toEqual([[true], [false]]);
  });

  it("keeps a recording alive across tool failure, idle, and human takeover", async () => {
    const apply = vi.fn(async (_active: boolean) => {});
    const activity = new AutomationActivity(apply, () => {});
    const stopRecording = await activity.acquire(true);
    await activity.run(async () => {});
    await activity.reset();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(apply.mock.calls).toEqual([[true]]);
    await stopRecording();
    expect(apply.mock.calls).toEqual([[true], [false]]);
  });

  it("never dispatches input after activation fails and can retry", async () => {
    const apply = vi
      .fn(async (_active: boolean) => {})
      .mockRejectedValueOnce(new Error("detached"));
    const activity = new AutomationActivity(apply, () => {});
    const work = vi.fn(async () => {});
    await expect(activity.run(work)).rejects.toThrow("detached");
    expect(work).not.toHaveBeenCalled();
    await activity.run(work);
    expect(work).toHaveBeenCalledOnce();
    await activity.close();
  });
  it("releases a native activation even when its acknowledgement was lost", async () => {
    let rendering = false;
    const apply = vi.fn(async (active: boolean) => {
      rendering = active;
      if (active) throw new Error("acknowledgement lost");
    });
    const activity = new AutomationActivity(apply, () => {});
    await expect(activity.run(async () => {})).rejects.toThrow("acknowledgement lost");
    expect(rendering).toBe(false);
    expect(apply.mock.calls).toEqual([[true], [false]]);
  });
});
