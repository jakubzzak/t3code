// @effect-diagnostics nodeBuiltinImport:off -- Tests execute the installed launcher against a temporary filesystem.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import * as NodeUtil from "node:util";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import { HostProcessEnvironment, HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { expect } from "vite-plus/test";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import * as DesktopConfig from "./DesktopConfig.ts";
import * as DesktopTerminalCommand from "./DesktopTerminalCommand.ts";

const hostPlatform = HostProcessPlatform.defaultValue();

const fixture = <A, E, R>(run: (root: string) => Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3 launcher's test-"))),
    (root) =>
      run(root).pipe(
        Effect.provide(
          DesktopTerminalCommand.layer.pipe(
            Layer.provideMerge(
              DesktopEnvironment.layer({
                dirname: NodePath.join(root, "app", "dist-electron"),
                homeDirectory: root,
                platform: hostPlatform,
                processArch: "arm64",
                appVersion: "0.0.1",
                appPath: NodePath.join(root, "app"),
                isPackaged: true,
                resourcesPath: NodePath.join(root, "resources"),
                runningUnderArm64Translation: false,
              }).pipe(
                Layer.provide(DesktopConfig.layerTest({ T3CODE_HOME: NodePath.join(root, ".t3") })),
              ),
            ),
            Layer.provide(NodeServices.layer),
            Layer.provideMerge(
              Layer.succeed(HostProcessEnvironment, {
                PATH: [
                  hostPlatform === "win32"
                    ? NodePath.join(root, "AppData", "Local", "T3Code", "bin")
                    : NodePath.join(root, ".local", "bin"),
                ].join(NodePath.delimiter),
              }),
            ),
          ),
        ),
      ),
    (root) => Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
  );

it.effect.skipIf(hostPlatform === "win32")(
  "installs a working launcher, forwards arguments, and removes only its launcher",
  () =>
    fixture((root) =>
      Effect.gen(function* () {
        const command = yield* DesktopTerminalCommand.DesktopTerminalCommand;
        const env = yield* DesktopEnvironment.DesktopEnvironment;
        yield* Effect.promise(async () => {
          await NodeFSP.mkdir(NodePath.dirname(env.backendEntryPath), { recursive: true });
          await NodeFSP.writeFile(
            env.backendEntryPath,
            "if (import.meta.main) console.log(JSON.stringify(process.argv.slice(2)))",
          );
        });
        const installed = yield* command.install;
        expect(installed.status).toBe("installed");
        expect(installed.onPath).toBe(true);
        const result = yield* Effect.promise(() =>
          NodeUtil.promisify(NodeChildProcess.execFile)(installed.path, [
            "app",
            "a folder's name",
            "--help",
          ]),
        );
        expect(result.stdout.trim()).toBe('["app","a folder\'s name","--help"]');
        expect((yield* command.install).status).toBe("installed");
        yield* Effect.promise(() => NodeFSP.writeFile(NodePath.join(root, "keep.txt"), "keep"));
        expect((yield* command.remove).status).toBe("not-installed");
        expect(
          yield* Effect.promise(() => NodeFSP.readFile(NodePath.join(root, "keep.txt"), "utf8")),
        ).toBe("keep");
      }),
    ),
);

it.effect("reports an existing command without replacing or removing it", () =>
  fixture(() =>
    Effect.gen(function* () {
      const command = yield* DesktopTerminalCommand.DesktopTerminalCommand;
      const initial = yield* command.get;
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(initial.directory, { recursive: true });
        await NodeFSP.writeFile(initial.path, "#!/bin/sh\necho independent\n", { mode: 0o755 });
      });
      expect((yield* command.install).status).toBe("conflict");
      expect((yield* command.remove).status).toBe("conflict");
      expect(yield* Effect.promise(() => NodeFSP.readFile(initial.path, "utf8"))).toContain(
        "independent",
      );
    }),
  ),
);

it.effect.skipIf(hostPlatform === "win32")(
  "leaves a symlinked independent command and its target intact",
  () =>
    fixture((root) =>
      Effect.gen(function* () {
        const command = yield* DesktopTerminalCommand.DesktopTerminalCommand;
        const initial = yield* command.get;
        const target = NodePath.join(root, "independent-t3");
        yield* Effect.promise(async () => {
          await NodeFSP.mkdir(initial.directory, { recursive: true });
          await NodeFSP.writeFile(target, "independent");
          await NodeFSP.symlink(target, initial.path);
        });
        expect((yield* command.install).status).toBe("conflict");
        expect((yield* command.remove).status).toBe("conflict");
        expect(yield* Effect.promise(() => NodeFSP.readlink(initial.path))).toBe(target);
        expect(yield* Effect.promise(() => NodeFSP.readFile(target, "utf8"))).toBe("independent");
      }),
    ),
);

it.effect("repairs an owned launcher on desktop startup after an update", () =>
  fixture(() =>
    Effect.gen(function* () {
      const command = yield* DesktopTerminalCommand.DesktopTerminalCommand;
      const installed = yield* command.install;
      const original = yield* Effect.promise(() => NodeFSP.readFile(installed.path, "utf8"));
      yield* Effect.promise(() =>
        NodeFSP.writeFile(
          installed.path,
          original.split("\n").slice(0, 2).join("\n") + "\nexit 1\n",
        ),
      );
      yield* command.register;
      expect(yield* Effect.promise(() => NodeFSP.readFile(installed.path, "utf8"))).toBe(original);
    }),
  ),
);

it.effect("detects another command on PATH and still removes only its own launcher", () =>
  fixture((root) =>
    Effect.gen(function* () {
      const command = yield* DesktopTerminalCommand.DesktopTerminalCommand;
      const installed = yield* command.install;
      const external = NodePath.join(root, "external", "t3");
      const processEnv = yield* HostProcessEnvironment;
      processEnv.PATH += NodePath.delimiter + NodePath.dirname(external);
      yield* Effect.promise(async () => {
        await NodeFSP.mkdir(NodePath.dirname(external));
        await NodeFSP.writeFile(external, "#!/bin/sh\necho independent\n", { mode: 0o755 });
      });
      expect(yield* command.get).toMatchObject({
        status: "conflict",
        installed: true,
        conflictingPath: external,
      });
      expect(yield* command.remove).toMatchObject({ status: "conflict", installed: false });
      expect((yield* command.install).status).toBe("conflict");
      expect(
        yield* Effect.promise(() =>
          NodeFSP.stat(installed.path).then(
            () => true,
            () => false,
          ),
        ),
      ).toBe(false);
      expect(yield* Effect.promise(() => NodeFSP.readFile(external, "utf8"))).toContain(
        "independent",
      );
    }),
  ),
);
