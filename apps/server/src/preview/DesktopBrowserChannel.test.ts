// @effect-diagnostics nodeBuiltinImport:off - Exercises the real inherited descriptor lifecycle in a subprocess.
import * as NodeChildProcess from "node:child_process";
import * as NodeURL from "node:url";

import * as NodeServices from "@effect/platform-node/NodeServices";
import * as NodeStream from "@effect/platform-node/NodeStream";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { vi } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import * as DesktopBrowserChannel from "./DesktopBrowserChannel.ts";

vi.mock("@effect/platform-node/NodeStream", () => ({ fromReadable: vi.fn() }));
vi.mock("node:net", () => ({
  Socket: class {
    destroy() {}
  },
}));

it.effect("protects unknown desktop visibility until an explicit hidden report arrives", () =>
  Effect.gen(function* () {
    const input = yield* Queue.unbounded<Uint8Array>();
    vi.mocked(NodeStream.fromReadable).mockReturnValue(Stream.fromQueue(input));
    const config = yield* ServerConfig.ServerConfig;
    yield* Effect.gen(function* () {
      const channel = yield* DesktopBrowserChannel.DesktopBrowserChannel;
      const key = { threadId: "thread-1", tabId: "tab-1" };
      const send = (event: object) =>
        Queue.offer(input, new TextEncoder().encode(`${JSON.stringify(event)}\n`));

      expect(channel.isShown(key)).toBe(true);
      yield* send({ type: "attached", ...key });
      yield* channel.awaitAttached(key, "5 seconds");
      expect(channel.isShown(key)).toBe(true);

      yield* send({ type: "shown", ...key, shown: false });
      yield* send({ type: "attached", threadId: key.threadId, tabId: "sentinel-1" });
      yield* channel.awaitAttached({ threadId: key.threadId, tabId: "sentinel-1" }, "5 seconds");
      expect(channel.isShown(key)).toBe(false);

      yield* send({ type: "shown", ...key, shown: true });
      yield* send({ type: "attached", threadId: key.threadId, tabId: "sentinel-2" });
      yield* channel.awaitAttached({ threadId: key.threadId, tabId: "sentinel-2" }, "5 seconds");
      expect(channel.isShown(key)).toBe(true);

      yield* send({ type: "shown", ...key, shown: false });
      yield* send({ type: "detached", ...key });
      yield* send({ type: "attached", threadId: key.threadId, tabId: "sentinel-3" });
      yield* channel.awaitAttached({ threadId: key.threadId, tabId: "sentinel-3" }, "5 seconds");
      expect(channel.isShown(key)).toBe(true);
    }).pipe(
      Effect.provide(
        DesktopBrowserChannel.layer.pipe(
          Layer.provide(
            ServerConfig.layer({ ...config, desktopBrowserFd: 41, desktopBrowserControlFd: 42 }),
          ),
        ),
      ),
    );
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "desktop-browser-channel-" }).pipe(
        Layer.provide(NodeServices.layer),
      ),
    ),
  ),
);

it.live("closes a tab's relay connection when the desktop detaches the tab", () =>
  Effect.gen(function* () {
    const input = yield* Queue.unbounded<Uint8Array>();
    vi.mocked(NodeStream.fromReadable).mockReturnValue(Stream.fromQueue(input));
    const config = yield* ServerConfig.ServerConfig;
    yield* Effect.gen(function* () {
      const channel = yield* DesktopBrowserChannel.DesktopBrowserChannel;
      const key = { threadId: "thread-1", tabId: "tab-1" };
      const send = (event: object) =>
        Queue.offer(input, new TextEncoder().encode(`${JSON.stringify(event)}\n`));

      yield* send({ type: "attached", ...key });
      yield* channel.awaitAttached(key, "5 seconds");
      const url = yield* channel.endpoint(key);
      const socket = new WebSocket(url);
      yield* Effect.addFinalizer(() => Effect.sync(() => socket.close()));
      const closed = new Promise<void>((resolve) =>
        socket.addEventListener("close", () => resolve()),
      );
      yield* Effect.promise(
        () => new Promise<void>((resolve) => socket.addEventListener("open", () => resolve())),
      );

      // Playwright waits on this socket for CDP replies; it must learn the tab is gone.
      yield* send({ type: "detached", ...key });
      yield* Effect.promise(() => closed).pipe(Effect.timeout("2 seconds"));
    }).pipe(
      Effect.scoped,
      Effect.provide(
        DesktopBrowserChannel.layer.pipe(
          Layer.provide(
            ServerConfig.layer({ ...config, desktopBrowserFd: 41, desktopBrowserControlFd: 42 }),
          ),
        ),
      ),
    );
  }).pipe(
    Effect.provide(
      ServerConfig.layerTest(process.cwd(), { prefix: "desktop-browser-channel-" }).pipe(
        Layer.provide(NodeServices.layer),
      ),
    ),
  ),
);

it("receives desktop messages and exits while the parent keeps both input pipes open", async () => {
  const child = NodeChildProcess.spawn(
    process.execPath,
    [NodeURL.fileURLToPath(new URL("./testing/DesktopPipeLifecycle.fixture.ts", import.meta.url))],
    { stdio: ["ignore", "pipe", "pipe", "pipe", "pipe", "pipe", "pipe"] },
  );
  // A failed exit must not leave a test process running. This never fires on success.
  // @effect-diagnostics-next-line globalTimers:off -- Bounds the native subprocess on failure; success waits for process exit.
  const watchdog = setTimeout(() => child.kill("SIGKILL"), 8_000);
  let output = "";
  let errors = "";
  let verified = false;
  let activityVerified = false;
  let activityCount = 0;
  let cancelledRequestId: string | undefined;
  let controlOutput = "";
  const control = child.stdio[4];
  control?.on("data", (chunk: Buffer) => {
    controlOutput += chunk.toString();
    let end: number;
    while ((end = controlOutput.indexOf("\n")) >= 0) {
      const command = JSON.parse(controlOutput.slice(0, end)) as {
        type: string;
        requestId: string;
        active: boolean;
      };
      controlOutput = controlOutput.slice(end + 1);
      if (command.type !== "activity") continue;
      activityCount++;
      if (activityCount === 1) {
        // An unrelated acknowledgement must not complete this request.
        write(3, { type: "activity", ...key, requestId: "unrelated", ok: false });
        write(3, { type: "activity", ...key, requestId: command.requestId, ok: true });
      } else if (activityCount === 2) {
        write(3, { type: "activity", ...key, requestId: command.requestId, ok: false });
      } else if (activityCount === 3) {
        cancelledRequestId = command.requestId;
        write(3, { type: "attached", ...key, tabId: "cancel-barrier" });
      } else if (activityCount === 5) {
        write(3, { type: "attached", ...key, tabId: "timeout-barrier" });
      } else {
        // The cancelled request's late failure cannot reject the next change.
        write(3, { type: "activity", ...key, requestId: cancelledRequestId, ok: false });
        write(3, { type: "activity", ...key, requestId: command.requestId, ok: true });
      }
    }
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    errors += chunk.toString();
  });
  const write = (fd: number, value: Record<string, unknown>) => {
    const stream = child.stdio[fd];
    if (!stream || !("write" in stream)) throw new Error(`Missing pipe ${fd}`);
    stream.write(`${JSON.stringify(value)}\n`);
  };
  const key = { threadId: "thread-1", tabId: "tab-1" };
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
    let end: number;
    while ((end = output.indexOf("\n")) >= 0) {
      const line = output.slice(0, end);
      output = output.slice(end + 1);
      if (line === "ready") {
        write(3, { type: "attached", ...key });
        write(5, { version: 1, type: "desktopTelemetryHello", electronPid: process.pid });
      } else if (line === "attached") {
        write(3, { type: "detached", ...key });
      } else if (line === "activity-verified") {
        activityVerified = true;
      } else if (line === "verified") {
        verified = true;
      }
    }
  });
  try {
    const result = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolve({ code, signal }));
      },
    );
    expect(errors).not.toContain("Error");
    expect(verified).toBe(true);
    expect(activityVerified).toBe(true);
    expect(activityCount).toBe(6);
    expect(result).toEqual({ code: 0, signal: null });
  } finally {
    clearTimeout(watchdog);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    for (const stream of child.stdio) stream?.destroy();
  }
});
