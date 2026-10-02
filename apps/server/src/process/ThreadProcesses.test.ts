import { ThreadId } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as Native from "../resourceTelemetry/NativeTelemetryClient.ts";
import * as ServerConfig from "../config.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Processes from "./ThreadProcesses.ts";
import { threadProcessOwner } from "./threadProcessOwnership.ts";

const threadId = ThreadId.make("process-cleanup-test");
const entry = { pid: 2147483646, ppid: 1, name: "owned job", startTimeMs: 1000 };
const layer = (processTable: Native.NativeTelemetryClient["Service"]["processTable"]) =>
  Processes.layer.pipe(
    Layer.provide(Native.layerTest({ processTable })),
    Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "cleanup-processes" })),
    Layer.provide(NodeServices.layer),
  );

it.effect("escalates a process that ignores TERM and verifies it exited", () =>
  Effect.gen(function* () {
    const term = yield* Deferred.make<void>();
    let alive = true;
    const signals: string[] = [];
    const kill = vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
      signals.push(String(signal));
      if (signal === "SIGKILL") alive = false;
      return true;
    });
    yield* Effect.gen(function* () {
      const service = yield* Processes.ThreadProcesses;
      const stopping = yield* service.stop(threadId, entry).pipe(Effect.forkChild);
      yield* Deferred.await(term);
      yield* TestClock.adjust("1 second");
      yield* Fiber.join(stopping);
      expect(signals).toEqual(["SIGTERM", "SIGKILL"]);
    }).pipe(
      Effect.provide(
        layer(
          Effect.suspend(() =>
            signals.includes("SIGTERM")
              ? Deferred.succeed(term, undefined).pipe(Effect.as(alive ? [entry] : []))
              : Effect.succeed([entry]),
          ),
        ),
      ),
      Effect.ensuring(Effect.sync(() => kill.mockRestore())),
    );
  }),
);

it.effect("never signals a PID whose birth identity changed", () => {
  const kill = vi.spyOn(process, "kill").mockImplementation(() => true);
  return Effect.gen(function* () {
    const service = yield* Processes.ThreadProcesses;
    yield* service.stop(threadId, entry);
    expect(kill).not.toHaveBeenCalled();
  }).pipe(
    Effect.provide(layer(Effect.succeed([{ ...entry, startTimeMs: 2000 }]))),
    Effect.ensuring(Effect.sync(() => kill.mockRestore())),
  );
});

it.effect("fails closed when the monitor cannot verify ownership", () =>
  Effect.gen(function* () {
    const service = yield* Processes.ThreadProcesses;
    const error = yield* service.list(threadId).pipe(Effect.flip);
    expect(error._tag).toBe("ThreadCleanupError");
  }).pipe(Effect.provide(layer(Effect.succeed([])))),
);

it("isolates environments while retaining ownership across server restarts", () => {
  expect(threadProcessOwner(threadId, "/first")).toBe(threadProcessOwner(threadId, "/first"));
  expect(threadProcessOwner(threadId, "/first")).not.toBe(threadProcessOwner(threadId, "/second"));
  expect(threadProcessOwner(threadId, "/first")).not.toBe(threadProcessOwner("other", "/first"));
});

it("includes protected descendants of captured terminals without claiming other trees", () => {
  const terminal = { pid: 10, ppid: 1, name: "shell", startTimeMs: 1000 };
  const protectedJob = { pid: 20, ppid: 10, name: "sleep", startTimeMs: 2000 };
  const grandchild = { pid: 30, ppid: 20, name: "worker", startTimeMs: 3000 };
  const other = { pid: 40, ppid: 1, name: "sleep", startTimeMs: 2000 };
  const recycledParent = { pid: 50, ppid: 10, name: "older job", startTimeMs: 500 };
  expect(
    Processes.identifiableThreadProcesses(
      [grandchild, other, protectedJob, terminal, recycledParent],
      [],
      [10],
    )
      .map((entry) => entry.pid)
      .sort(),
  ).toEqual([10, 20, 30]);
  expect(
    Processes.identifiableThreadProcesses([other], [{ ...other, startTimeMs: 1000 }], []),
  ).toEqual([]);
});
