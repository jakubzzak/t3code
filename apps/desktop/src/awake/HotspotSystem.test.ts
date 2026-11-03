import { describe, expect, beforeEach, vi } from "vite-plus/test";
import { it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Stream from "effect/Stream";
import * as Sink from "effect/Sink";
import * as Spawner from "effect/process/ChildProcessSpawner";
import { DesktopEnvironment } from "../app/DesktopEnvironment.ts";
import { make } from "./HotspotSystem.ts";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("electron", () => ({ net: { fetch: fetchMock } }));
beforeEach(() => fetchMock.mockReset());

const fixture = (pending = false, result = '{"authorized":true,"name":"iPhone"}') =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const directory = yield* fs.makeTempDirectoryScoped({ prefix: "hotspot-adapter-test-" });
    const started = yield* Deferred.make<void>();
    let lease = "";
    let args: ReadonlyArray<string> = [];
    const spawner = Spawner.make((command) =>
      Effect.gen(function* () {
        if (command._tag !== "StandardCommand") return yield* Effect.die("Unexpected pipeline");
        expect(command.command).toBe("/usr/bin/open");
        args = command.args;
        lease = args[args.indexOf("--lease") + 1]!;
        expect(yield* fs.exists(lease)).toBe(true);
        const output = args[args.indexOf("--stdout") + 1]!;
        yield* fs.writeFileString(output, result);
        yield* Deferred.succeed(started, undefined);
        return Spawner.makeHandle({
          pid: Spawner.ProcessId(123),
          exitCode: pending ? Effect.never : Effect.succeed(Spawner.ExitCode(0)),
          isRunning: Effect.succeed(pending),
          kill: () => Effect.void,
          stdin: Sink.drain,
          stdout: Stream.empty,
          stderr: Stream.empty,
          all: Stream.empty,
          getInputFd: () => Sink.drain,
          getOutputFd: () => Stream.empty,
          unref: Effect.succeed(Effect.void),
        });
      }),
    );
    const system = yield* make.pipe(
      Effect.provideService(Spawner.ChildProcessSpawner, spawner),
      Effect.provideService(DesktopEnvironment, {
        resolveResourcePathCandidates: () => [directory],
      } as unknown as DesktopEnvironment["Service"]),
    );
    return {
      system,
      started,
      args: () => args,
      lease: () => lease,
      fs,
      result: (value: string) => {
        result = value;
      },
    };
  });

describe("hotspot OS adapter", () => {
  it.effect("rejects an empty native status instead of reporting a disconnected network", () =>
    Effect.gen(function* () {
      const h = yield* fixture(false, "");
      const error = yield* h.system.currentName.pipe(Effect.flip);
      expect(error.message).toBe("Could not identify the current Wi-Fi network.");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("launches all operations under one app identity and removes each lease", () =>
    Effect.gen(function* () {
      const h = yield* fixture();
      yield* h.system.authorize;
      expect(h.args().slice(-1)).toEqual(["authorize"]);
      expect(yield* h.fs.exists(h.lease())).toBe(false);
      expect(yield* h.system.currentName).toBe("iPhone");
      expect(h.args().slice(-1)).toEqual(["status"]);
      expect(yield* h.system.join).toBe("iPhone");
      expect(h.args().slice(-1)).toEqual(["join"]);
      h.result(JSON.stringify({ name: "Home $(not-a-command)" }));
      yield* h.system.joinKnown("Home $(not-a-command)", "iPhone");
      expect(h.args().slice(-3)).toEqual(["join-known", "Home $(not-a-command)", "iPhone"]);
      expect(yield* h.fs.exists(h.lease())).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect.each(["", "private-native-details", '{"name":"Another network"}'])(
    "rejects an unconfirmed Wi-Fi return even when the launcher exits zero: %s",
    (output) =>
      Effect.gen(function* () {
        const h = yield* fixture(false, output);
        const error = yield* h.system.joinKnown("Home", "iPhone").pipe(Effect.flip);
        expect(error.message).toContain("Could not return to saved Wi-Fi");
        expect(error.message).not.toContain("private-native-details");
        expect(yield* h.fs.exists(h.lease())).toBe(false);
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("revokes the native lease on cancellation even when open never exits", () =>
    Effect.gen(function* () {
      const h = yield* fixture(true);
      const fiber = yield* h.system.join.pipe(Effect.forkChild);
      yield* Deferred.await(h.started);
      expect(yield* h.fs.exists(h.lease())).toBe(true);
      yield* Fiber.interrupt(fiber);
      expect(yield* h.fs.exists(h.lease())).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("rejects malformed native output without exposing it", () =>
    Effect.gen(function* () {
      const h = yield* fixture(false, "private-native-details");
      const error = yield* h.system.join.pipe(Effect.flip);
      expect(error.message).toContain("Could not join");
      expect(error.message).not.toContain("private-native-details");
      expect(yield* h.fs.exists(h.lease())).toBe(false);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );

  it.effect("does not mistake a captive portal for internet; tolerates one filtered probe", () =>
    Effect.gen(function* () {
      const h = yield* fixture();
      fetchMock.mockResolvedValueOnce(new Response("<BODY>Success</BODY>"));
      expect(yield* h.system.online).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      fetchMock.mockResolvedValueOnce(new Response("Sign in to Wi-Fi"));
      fetchMock.mockResolvedValueOnce(new Response("Sign in to Wi-Fi"));
      expect(yield* h.system.online).toBe(false);
      fetchMock.mockRejectedValueOnce(new Error("filtered"));
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
      expect(yield* h.system.online).toBe(true);
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
  );
});
