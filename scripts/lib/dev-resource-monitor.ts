import * as NodeOS from "node:os";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { ChildProcess } from "effect/unstable/process";

export class DevResourceMonitorBuildError extends Schema.TaggedError<DevResourceMonitorBuildError>()(
  "DevResourceMonitorBuildError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return "Could not build the resource monitor required for chat cleanup. Install Rust and run `vp run build:resource-monitor`, or set T3CODE_RESOURCE_MONITOR_PATH to a compatible binary.";
  }
}

/** Cargo's incremental build also refreshes helpers whose ownership protocol changed. */
export const prepareDevResourceMonitor = Effect.fn("prepareDevResourceMonitor")(function* () {
  const environment = yield* HostProcessEnvironment;
  if (environment.T3CODE_RESOURCE_MONITOR_PATH) return environment.T3CODE_RESOURCE_MONITOR_PATH;
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcessPlatform;
  const crate = path.resolve(import.meta.dirname, "../../native/resource-monitor");
  const executable = platform === "win32" ? "t3-resource-monitor.exe" : "t3-resource-monitor";
  const cargoHome = environment.CARGO_HOME || path.join(NodeOS.homedir(), ".cargo");
  const cargoPath = path.join(cargoHome, "bin", platform === "win32" ? "cargo.exe" : "cargo");
  const cargo = (yield* fs.exists(cargoPath)) ? cargoPath : "cargo";
  yield* Effect.logInfo("[dev-runner] preparing resource monitor");
  const build = Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make(
        cargo,
        [
          "build",
          "--locked",
          "--release",
          "--manifest-path",
          path.join(crate, "Cargo.toml"),
          "--target-dir",
          path.join(crate, "target"),
        ],
        { cwd: crate, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
      );
      const exitCode = yield* child.exitCode;
      if (exitCode !== 0) return yield* Effect.fail(exitCode);
      return path.join(crate, "target/release", executable);
    }),
  );
  return yield* build.pipe(Effect.mapError((cause) => new DevResourceMonitorBuildError({ cause })));
});
