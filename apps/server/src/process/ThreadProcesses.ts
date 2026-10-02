import { ServerConfig } from "../config.ts";
import {
  ThreadCleanupError,
  ThreadId,
  type ResourceMonitorProcessTableEntry,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Schedule from "effect/Schedule";
import * as NativeTelemetryClient from "../resourceTelemetry/NativeTelemetryClient.ts";
import { threadProcessOwner } from "./threadProcessOwnership.ts";

export class ThreadProcesses extends Context.Service<
  ThreadProcesses,
  {
    readonly list: (
      threadId: ThreadId,
      rootPids?: ReadonlyArray<number>,
    ) => Effect.Effect<ReadonlyArray<ResourceMonitorProcessTableEntry>, ThreadCleanupError>;
    readonly stop: (
      threadId: ThreadId,
      entry: ResourceMonitorProcessTableEntry,
    ) => Effect.Effect<void, ThreadCleanupError>;
  }
>()("t3/process/ThreadProcesses") {}

const make = Effect.gen(function* () {
  const { stateDir } = yield* ServerConfig;
  const monitor = yield* NativeTelemetryClient.NativeTelemetryClient;
  const list = Effect.fn("ThreadProcesses.list")(
    function* (threadId: ThreadId, rootPids: ReadonlyArray<number> = []) {
      const capabilities = yield* monitor.capabilities.pipe(
        Effect.catch((original) =>
          Effect.scoped(
            Effect.gen(function* () {
              const subscription = yield* monitor.subscribeHealth;
              if (!(yield* monitor.retry)) return yield* original;
              yield* subscription.changes.pipe(
                Stream.filter(
                  (health) =>
                    health.status === "healthy" ||
                    health.status === "unavailable" ||
                    health.status === "degraded",
                ),
                Stream.runHead,
                Effect.timeout("5 seconds"),
              );
              return yield* monitor.capabilities;
            }),
          ),
        ),
      );
      if (!capabilities.threadProcessOwnership) {
        return yield* new ThreadCleanupError({
          threadId,
          detail:
            "Update the resource monitor to identify managed chat processes. Cleanup has not started.",
        });
      }
      const tagged = yield* monitor.ownedProcesses(threadProcessOwner(threadId, stateDir));
      const table = yield* monitor.processTable;
      return identifiableThreadProcesses(table, tagged, rootPids);
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.mapError((cause) => new ThreadCleanupError({ threadId, detail: cause.message })),
      ),
  );

  const stop = Effect.fn("ThreadProcesses.stop")(
    function* (threadId: ThreadId, entry: ResourceMonitorProcessTableEntry) {
      if (entry.pid === process.pid || entry.startTimeMs === undefined) {
        return yield* new ThreadCleanupError({
          threadId,
          detail: `Cannot verify ownership of ${entry.name} (${entry.pid}).`,
        });
      }
      const alive = monitor.processTable.pipe(
        Effect.map((entries) =>
          entries.some(
            (candidate) =>
              candidate.pid === entry.pid && candidate.startTimeMs === entry.startTimeMs,
          ),
        ),
      );
      const signal = Effect.fnUntraced(function* (signal: "SIGTERM" | "SIGKILL") {
        if (!(yield* alive)) return;
        yield* Effect.try({
          try: () => {
            try {
              process.kill(entry.pid, signal);
            } catch (cause) {
              if (
                !(
                  typeof cause === "object" &&
                  cause !== null &&
                  "code" in cause &&
                  cause.code === "ESRCH"
                )
              )
                throw cause;
            }
          },
          catch: () =>
            new ThreadCleanupError({
              threadId,
              detail: `Could not stop ${entry.name} (${entry.pid}).`,
            }),
        });
      });
      const wait = alive.pipe(
        Effect.repeat({ schedule: Schedule.spaced("100 millis"), while: (running) => running }),
        Effect.timeoutOption("1 second"),
      );
      // The identity came from the ownership scan before stopping the provider.
      // Keep it through reparenting, but never signal a recycled PID.
      yield* signal("SIGTERM");
      if (Option.isNone(yield* wait)) {
        yield* signal("SIGKILL");
        if (Option.isNone(yield* wait)) {
          return yield* new ThreadCleanupError({
            threadId,
            detail: `${entry.name} (${entry.pid}) is still running.`,
          });
        }
      }
    },
    (effect, threadId) =>
      effect.pipe(
        Effect.mapError((cause) => new ThreadCleanupError({ threadId, detail: cause.message })),
      ),
  );
  return ThreadProcesses.of({ list, stop });
});

export const layer = Layer.effect(ThreadProcesses, make);

/** Expand only captured roots and matching birth identities; names and paths are never ownership. */
export function identifiableThreadProcesses(
  table: ReadonlyArray<ResourceMonitorProcessTableEntry>,
  tagged: ReadonlyArray<ResourceMonitorProcessTableEntry>,
  rootPids: ReadonlyArray<number>,
) {
  const owned = new Map(
    table
      .filter(
        (entry) =>
          rootPids.includes(entry.pid) ||
          tagged.some((root) => root.pid === entry.pid && root.startTimeMs === entry.startTimeMs),
      )
      .map((entry) => [entry.pid, entry]),
  );
  let changed = true;
  while (changed) {
    changed = false;
    for (const entry of table) {
      const parent = owned.get(entry.ppid);
      if (
        !owned.has(entry.pid) &&
        parent &&
        entry.startTimeMs !== undefined &&
        parent.startTimeMs !== undefined &&
        entry.startTimeMs >= parent.startTimeMs
      ) {
        owned.set(entry.pid, entry);
        changed = true;
      }
    }
  }
  return [...owned.values()];
}
