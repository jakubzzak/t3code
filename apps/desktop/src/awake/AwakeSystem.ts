import type * as Duration from "effect/Duration";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as Electron from "electron";

import { DesktopEnvironment } from "../app/DesktopEnvironment.ts";
import {
  ElectronPowerMonitor,
  type ElectronThermalState,
} from "../electron/ElectronPowerMonitor.ts";
import {
  AWAKE_HELPER,
  AWAKE_LABEL,
  AWAKE_PLIST,
  AWAKE_ROOT,
  AWAKE_SUDOERS,
  installAwakeCommand,
  removeAwakeCommand,
} from "./AwakeInstallation.ts";
import { parseBattery, parseLidClosed, type BatteryReading } from "./AwakePolicy.ts";

export class AwakeError extends Schema.TaggedError<AwakeError>()("AwakeError", {
  message: Schema.String,
}) {}

const isAwakeError = Schema.is(AwakeError);

export class AwakeSystem extends Context.Service<
  AwakeSystem,
  {
    readonly supported: boolean;
    readonly installed: Effect.Effect<boolean, AwakeError>;
    readonly setup: Effect.Effect<void, AwakeError>;
    readonly remove: Effect.Effect<void, AwakeError>;
    readonly apply: (token: string, lowPower: boolean) => Effect.Effect<void, AwakeError>;
    readonly release: (token: string) => Effect.Effect<void, AwakeError>;
    readonly battery: Effect.Effect<BatteryReading | null, AwakeError>;
    readonly thermal: Effect.Effect<ElectronThermalState>;
    readonly lid: Effect.Effect<boolean | null, AwakeError>;
    readonly sleepDisplay: Effect.Effect<void, AwakeError>;
    readonly wakeDisplay: Effect.Effect<void, AwakeError>;
    readonly holdApp: (enabled: boolean) => Effect.Effect<void, AwakeError>;
  }
>()("@t3tools/desktop/awake/AwakeSystem") {}

/** @public Effect service construction. OS commands are confined to this adapter. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const monitor = yield* ElectronPowerMonitor;
  let blocker: number | null = null;

  const run = Effect.fnUntraced(function* (
    command: string,
    args: ReadonlyArray<string>,
    timeout: Duration.Input = "15 seconds",
  ) {
    return yield* Effect.scoped(
      Effect.gen(function* () {
        const child = yield* spawner.spawn(ChildProcess.make(command, args, { stdin: "ignore" }));
        const [stdout, stderr, exit] = yield* Effect.all(
          [
            child.stdout.pipe(Stream.decodeText(), Stream.mkString),
            child.stderr.pipe(Stream.decodeText(), Stream.mkString),
            child.exitCode,
          ],
          { concurrency: "unbounded" },
        );
        return { stdout, stderr, exit: Number(exit) };
      }),
    ).pipe(
      Effect.timeout(timeout),
      Effect.mapError(
        () => new AwakeError({ message: "The Keep awake system command did not finish." }),
      ),
    );
  });
  const checked = Effect.fnUntraced(function* (
    command: string,
    args: ReadonlyArray<string>,
    timeout?: Duration.Input,
  ) {
    const result = yield* run(command, args, timeout);
    if (result.exit !== 0)
      return yield* new AwakeError({
        message: result.stderr.includes("-128")
          ? "Keep awake setup was canceled."
          : result.stderr.trim() || "The Keep awake system command failed.",
      });
    return result.stdout;
  });
  const admin = (command: string) =>
    checked(
      "/usr/bin/osascript",
      [
        "-e",
        "on run argv",
        "-e",
        "do shell script (item 1 of argv) with administrator privileges",
        "-e",
        "end run",
        command,
      ],
      "5 minutes",
    ).pipe(Effect.asVoid);
  const helper = (args: ReadonlyArray<string>) =>
    checked("/usr/bin/sudo", ["-n", AWAKE_HELPER, ...args]).pipe(Effect.asVoid);
  const recoveryRunning = checked("/bin/launchctl", ["print", `system/${AWAKE_LABEL}`]).pipe(
    Effect.asVoid,
  );

  return AwakeSystem.of({
    supported: environment.platform === "darwin",
    installed: Effect.gen(function* () {
      if (environment.platform !== "darwin") return false;
      // Include partial installs so the user can remove and retry setup.
      for (const path of [AWAKE_HELPER, AWAKE_PLIST, AWAKE_ROOT, AWAKE_SUDOERS]) {
        if (yield* fs.exists(path)) return true;
      }
      return false;
    }).pipe(
      Effect.mapError((error) =>
        isAwakeError(error)
          ? error
          : new AwakeError({ message: "Could not inspect Keep awake setup." }),
      ),
    ),
    setup: Effect.gen(function* () {
      if (environment.platform !== "darwin")
        return yield* new AwakeError({
          message: "Keep awake is available in the macOS desktop app.",
        });
      const sourcePath = environment.resolveResourcePathCandidates("awake/helper.sh");
      let source: string | null = null;
      for (const candidate of sourcePath) {
        if (yield* fs.exists(candidate)) {
          source = yield* fs.readFileString(candidate);
          break;
        }
      }
      if (source === null)
        return yield* new AwakeError({ message: "This build is missing its Keep awake helper." });
      const uid = Number((yield* checked("/usr/bin/id", ["-u"])).trim());
      yield* admin(installAwakeCommand(source, uid));
      yield* recoveryRunning;
    }).pipe(
      Effect.mapError((error) =>
        isAwakeError(error)
          ? error
          : new AwakeError({ message: "Could not prepare Keep awake setup." }),
      ),
    ),
    remove: admin(removeAwakeCommand),
    apply: (token, lowPower) =>
      recoveryRunning.pipe(
        Effect.andThen(helper(["apply", token, String(process.pid), lowPower ? "1" : "0"])),
      ),
    release: (token) => helper(["release", token]),
    battery: checked("/usr/bin/pmset", ["-g", "batt"]).pipe(Effect.map(parseBattery)),
    thermal: monitor.getCurrentThermalState,
    lid: checked("/usr/sbin/ioreg", ["-r", "-k", "AppleClamshellState", "-d", "1"]).pipe(
      Effect.map(parseLidClosed),
    ),
    sleepDisplay: checked("/usr/bin/pmset", ["displaysleepnow"]).pipe(Effect.asVoid),
    wakeDisplay: checked("/usr/bin/caffeinate", ["-u", "-t", "1"]).pipe(Effect.asVoid),
    holdApp: (enabled) =>
      Effect.try({
        try: () => {
          if (enabled && blocker === null)
            blocker = Electron.powerSaveBlocker.start("prevent-app-suspension");
          if (!enabled && blocker !== null) {
            Electron.powerSaveBlocker.stop(blocker);
            blocker = null;
          }
        },
        catch: () => new AwakeError({ message: "Could not update the app sleep assertion." }),
      }),
  });
});

export const layer = Layer.effect(AwakeSystem, make);
