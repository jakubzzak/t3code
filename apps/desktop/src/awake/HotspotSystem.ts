import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Electron from "electron";
import { DesktopEnvironment } from "../app/DesktopEnvironment.ts";
import { parseKnownNetworks, parseWifiDevice } from "./HotspotPolicy.ts";

export class HotspotError extends Schema.TaggedError<HotspotError>()("HotspotError", {
  message: Schema.String,
}) {}

export class HotspotSystem extends Context.Service<
  HotspotSystem,
  {
    readonly online: Effect.Effect<boolean>;
    readonly authorize: Effect.Effect<void, HotspotError>;
    readonly knownInRange: Effect.Effect<ReadonlyArray<string>, HotspotError>;
    readonly currentName: Effect.Effect<string | null, HotspotError>;
    readonly join: Effect.Effect<string, HotspotError>;
    readonly joinKnown: (
      name: string,
      expectedHotspot: string,
    ) => Effect.Effect<void, HotspotError>;
  }
>()("@t3tools/desktop/awake/HotspotSystem") {}

const decodeScan = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({
      authorized: Schema.Boolean,
      names: Schema.Array(Schema.String),
    }),
  ),
);
const decodeJoin = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ name: Schema.NonEmptyString })),
);
const decodeStatus = Schema.decodeUnknownEffect(
  Schema.fromJsonString(
    Schema.Struct({ authorized: Schema.Boolean, name: Schema.NullOr(Schema.String) }),
  ),
);
const decodeAuthorization = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ authorized: Schema.Boolean })),
);

/** Native credentials stay inside the helper; they never enter Electron or command arguments. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const error = (message: string) => new HotspotError({ message });

  const run = Effect.fnUntraced(function* (
    command: string,
    args: ReadonlyArray<string>,
    timeout: Duration.Input = "20 seconds",
  ) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner.spawn(ChildProcess.make(command, args, { stdin: "ignore" }));
        const [stdout, exit] = yield* Effect.all(
          [
            child.stdout.pipe(Stream.decodeText(), Stream.mkString),
            child.exitCode,
            // Drain errors without exposing native network metadata in logs or UI.
            child.stderr.pipe(Stream.runDrain),
          ],
          { concurrency: "unbounded" },
        );
        if (Number(exit) !== 0)
          return yield* error(
            "Hotspot connection failed. Check the nearby iPhone and Blackbird Hotspot’s Location Services permission.",
          );
        return stdout;
      }),
    ).pipe(
      Effect.timeout(timeout),
      Effect.mapError(() =>
        error(
          "Hotspot connection failed or timed out. Check the nearby iPhone and Blackbird Hotspot’s Location Services permission.",
        ),
      ),
    );
  });
  const helper = Effect.gen(function* () {
    for (const candidate of environment.resolveResourcePathCandidates(
      "hotspot/Blackbird Hotspot.app",
    )) {
      if (yield* fs.exists(candidate)) return candidate;
    }
    return yield* error("This build is missing the hotspot helper.");
  }).pipe(Effect.mapError(() => error("This build is missing the hotspot helper.")));
  const native = (args: ReadonlyArray<string>, timeout?: Duration.Input) =>
    helper.pipe(
      Effect.flatMap((app) => {
        // Every mode uses the helper's Launch Services identity for Location permission.
        // Removing this scoped lease cancels the launched app, not just /usr/bin/open.
        return Effect.scoped(
          Effect.gen(function* () {
            const directory = yield* fs.makeTempDirectoryScoped({ prefix: "blackbird-hotspot-" });
            const output = path.join(directory, "result.json");
            const lease = path.join(directory, "lease");
            yield* fs.writeFileString(lease, "active");
            yield* run(
              "/usr/bin/open",
              [
                "-W",
                "-n",
                "-g",
                "--stdout",
                output,
                "--stderr",
                "/dev/null",
                app,
                "--args",
                "--lease",
                lease,
                ...args,
              ],
              timeout,
            );
            return yield* fs.readFileString(output);
          }),
        ).pipe(
          Effect.mapError(() =>
            error(
              "Could not read the hotspot helper. Check Blackbird Hotspot’s Location Services permission.",
            ),
          ),
        );
      }),
    );
  const device = run("/usr/sbin/networksetup", ["-listallhardwareports"]).pipe(
    Effect.flatMap((output) => {
      const name = parseWifiDevice(output);
      return name === null
        ? Effect.fail(error("No Wi-Fi interface is available."))
        : Effect.succeed(name);
    }),
  );

  return HotspotSystem.of({
    online: Effect.tryPromise({
      try: async (signal) => {
        const probe = async (url: string, accepts: (response: Response) => Promise<boolean>) => {
          try {
            const response = await Electron.net.fetch(url, {
              cache: "no-store",
              redirect: "error",
              signal: AbortSignal.any([signal, AbortSignal.timeout(4_000)]),
            });
            return await accepts(response);
          } catch {
            return false;
          }
        };
        // Require two independent failures before treating a filtered endpoint as an outage.
        if (
          await probe(
            "https://captive.apple.com/hotspot-detect.html",
            async (response) =>
              response.ok && (await response.text()).includes("<BODY>Success</BODY>"),
          )
        )
          return true;
        if (signal.aborted) return false;
        return await probe(
          "https://www.gstatic.com/generate_204",
          async (response) => response.status === 204,
        );
      },
      catch: () => false,
    }).pipe(Effect.orElseSucceed(() => false)),
    authorize: native(["authorize"], "130 seconds").pipe(
      Effect.flatMap(decodeAuthorization),
      Effect.flatMap((result) =>
        result.authorized
          ? Effect.void
          : Effect.fail(
              error(
                "Allow Blackbird Hotspot in System Settings → Privacy & Security → Location Services.",
              ),
            ),
      ),
      Effect.mapError(() =>
        error(
          "Allow Blackbird Hotspot in System Settings → Privacy & Security → Location Services.",
        ),
      ),
    ),
    knownInRange: Effect.gen(function* () {
      const scan = yield* native(["scan"], "25 seconds").pipe(
        Effect.flatMap(decodeScan),
        Effect.mapError(() =>
          error("Could not scan Wi-Fi. Check Blackbird Hotspot’s Location Services permission."),
        ),
      );
      if (!scan.authorized)
        return yield* error(
          "Allow Blackbird Hotspot in System Settings → Privacy & Security → Location Services.",
        );
      const known = parseKnownNetworks(
        yield* run("/usr/sbin/networksetup", ["-listpreferredwirelessnetworks", yield* device]),
      );
      return known.filter((name) => scan.names.includes(name));
    }),
    currentName: native(["status"], "10 seconds").pipe(
      Effect.flatMap(decodeStatus),
      Effect.map((result) => (result.authorized ? result.name : null)),
      Effect.mapError(() => error("Could not identify the current Wi-Fi network.")),
    ),
    join: native(["join"], "65 seconds").pipe(
      Effect.flatMap(decodeJoin),
      Effect.map((result) => result.name),
      Effect.mapError(() =>
        error(
          "Could not join the iPhone hotspot. Check the nearby iPhone and Blackbird Hotspot’s Location Services permission.",
        ),
      ),
    ),
    joinKnown: (name, expectedHotspot) =>
      native(["join-known", name, expectedHotspot], "65 seconds").pipe(
        Effect.asVoid,
        Effect.mapError(() =>
          error(
            "Could not return to saved Wi-Fi. Blackbird will try another network or retry later.",
          ),
        ),
      ),
  });
});

export const layer = Layer.effect(HotspotSystem, make);
