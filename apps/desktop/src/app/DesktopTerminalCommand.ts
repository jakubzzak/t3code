// @effect-diagnostics nodeBuiltinImport:off -- The launcher adapter uses exclusive writes and lstat to preserve independent commands.
import { type DesktopTerminalCommandState, DesktopLauncherRegistration } from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import { HostProcessEnvironment, HostProcessExecutablePath } from "@t3tools/shared/hostProcess";
import * as Option from "effect/Option";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";

export class DesktopTerminalCommandError extends Schema.TaggedError<DesktopTerminalCommandError>()(
  "DesktopTerminalCommandError",
  { operation: Schema.String, path: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Could not ${this.operation} the terminal command at ${this.path}. Check access to this path and try again.`;
  }
}

export class DesktopTerminalCommand extends Context.Service<
  DesktopTerminalCommand,
  {
    readonly get: Effect.Effect<DesktopTerminalCommandState, DesktopTerminalCommandError>;
    readonly install: Effect.Effect<DesktopTerminalCommandState, DesktopTerminalCommandError>;
    readonly remove: Effect.Effect<DesktopTerminalCommandState, DesktopTerminalCommandError>;
    readonly register: Effect.Effect<void, DesktopTerminalCommandError>;
  }
>()("@t3tools/desktop/app/DesktopTerminalCommand") {}

const encodeRegistration = Schema.encodeSync(Schema.fromJsonString(DesktopLauncherRegistration));
const encodeString = Schema.encodeSync(Schema.fromJsonString(Schema.String));

const make = Effect.gen(function* () {
  const env = yield* DesktopEnvironment.DesktopEnvironment;
  const processEnv = yield* HostProcessEnvironment;
  const runtimePath = yield* HostProcessExecutablePath;
  const windows = env.platform === "win32";
  const directory = windows
    ? env.path.join(env.homeDirectory, "AppData", "Local", "T3Code", "bin")
    : env.path.join(env.homeDirectory, ".local", "bin");
  const launcherPath = env.path.join(directory, windows ? "t3.cmd" : "t3");
  const registrationPath = env.path.join(env.baseDir, "desktop-launcher.json");
  const executablePath = Option.getOrElse(env.appImagePath, () => runtimePath);
  const registration: DesktopLauncherRegistration = {
    executablePath,
    args: env.isPackaged ? [] : [env.path.join(env.dirname, "main.cjs")],
    stateDir: env.stateDir,
    ...Option.match(env.devServerUrl, {
      onNone: () => ({}),
      onSome: (url) => ({ devServerUrl: url.href }),
    }),
    ...Option.match(env.configuredBackendPort, {
      onNone: () => ({}),
      onSome: (backendPort) => ({ backendPort }),
    }),
  };
  // Resolve from the running executable so AppImage remounts and normal app updates
  // do not leave a launcher pointing into an obsolete resources directory.
  const relativeEntry = env.path.relative(env.path.dirname(runtimePath), env.backendEntryPath);
  // Run as the CLI entrypoint: dynamic import would leave import.meta.main false.
  const bootstrap = `process.env.T3CODE_HOME ??= ${encodeString(env.baseDir)};const p=require('node:path');const e=p.resolve(p.dirname(process.execPath),${encodeString(relativeEntry)});process.argv.splice(1,0,e);require('node:module').runMain(e);`;
  const marker = `T3 Code desktop launcher: ${encodeURIComponent(env.baseDir)}`;
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const batchQuote = (value: string) => `"${value.replaceAll("%", "%%").replaceAll('"', '""')}"`;
  const encodedBootstrap = `eval(Buffer.from('${Buffer.from(bootstrap).toString("base64")}','base64').toString())`;
  const script = windows
    ? `@echo off
@rem ${marker}
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
${batchQuote(executablePath)} -e ${batchQuote(encodedBootstrap)} -- %*
exit /b %errorlevel%
`
    : `#!/bin/sh
# ${marker}
export ELECTRON_RUN_AS_NODE=1
exec ${quote(executablePath)} -e ${quote(bootstrap)} -- "$@"
`;
  const samePath = (a: string, b: string) =>
    windows ? a.toLowerCase() === b.toLowerCase() : a === b;
  const inspect = async (file: string) => {
    try {
      const stat = await NodeFSP.lstat(file);
      if (stat.isSymbolicLink() || !stat.isFile()) return "foreign";
      const handle = await NodeFSP.open(file, "r");
      let text: string;
      try {
        const buffer = Buffer.alloc(4096);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        text = buffer.toString("utf8", 0, bytesRead);
      } finally {
        await handle.close();
      }
      return text.split(/\r?\n/)[1] === `${windows ? "@rem" : "#"} ${marker}` ? "owned" : "foreign";
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return "missing";
      throw error;
    }
  };
  const state = async (): Promise<DesktopTerminalCommandState> => {
    // The desktop hydrates its login-shell PATH after constructing services.
    const pathEntries = (processEnv.PATH ?? processEnv.Path ?? "")
      .split(windows ? ";" : ":")
      .filter(Boolean);
    const onPath = pathEntries.some((entry) => samePath(env.path.resolve(entry), directory));
    const own = await inspect(launcherPath);
    let conflictingPath = own === "foreign" ? launcherPath : null;
    for (const entry of pathEntries) {
      for (const name of windows ? ["t3.exe", "t3.cmd", "t3.bat", "t3"] : ["t3"]) {
        const candidate = env.path.resolve(entry, name);
        if (samePath(candidate, launcherPath)) continue;
        if ((await inspect(candidate)) !== "missing") {
          conflictingPath ??= candidate;
        }
      }
    }
    return {
      installed: own === "owned",
      status: conflictingPath ? "conflict" : own === "owned" ? "installed" : "not-installed",
      path: launcherPath,
      directory,
      onPath,
      conflictingPath,
    };
  };
  const operation = <A>(name: string, run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) =>
        new DesktopTerminalCommandError({ operation: name, path: launcherPath, cause }),
    });
  const register = operation("register", async () => {
    await NodeFSP.mkdir(env.baseDir, { recursive: true });
    const temporary = `${registrationPath}.${NodeCrypto.randomUUID()}.tmp`;
    try {
      await NodeFSP.writeFile(temporary, encodeRegistration(registration), {
        mode: 0o600,
        flag: "wx",
      });
      await NodeFSP.rename(temporary, registrationPath);
    } finally {
      await NodeFSP.rm(temporary, { force: true });
    }
    if ((await inspect(launcherPath)) === "owned") {
      await NodeFSP.writeFile(launcherPath, script, { mode: 0o755 });
    }
  });
  return DesktopTerminalCommand.of({
    get: operation("inspect", state),
    register,
    install: Effect.gen(function* () {
      const before = yield* operation("inspect", state);
      if (before.status === "conflict") return before;
      yield* register;
      return yield* operation("install", async () => {
        await NodeFSP.mkdir(directory, { recursive: true });
        // Exclusive creation protects independent commands appearing after inspection.
        if (before.status === "not-installed") {
          await NodeFSP.writeFile(launcherPath, script, { mode: 0o755, flag: "wx" });
        } else if ((await inspect(launcherPath)) === "owned") {
          await NodeFSP.writeFile(launcherPath, script, { mode: 0o755 });
        }
        return state();
      });
    }),
    remove: operation("remove", async () => {
      if ((await inspect(launcherPath)) === "owned") await NodeFSP.unlink(launcherPath);
      return state();
    }),
  });
});

export const layer = Layer.effect(DesktopTerminalCommand, make);
