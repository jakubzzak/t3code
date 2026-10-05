// @effect-diagnostics nodeBuiltinImport:off -- The integration fixture binds the same platform socket or named pipe as the CLI.
import * as NodeChildProcess from "node:child_process";
import * as NodeFSP from "node:fs/promises";
import * as NodeNet from "node:net";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeServices from "@effect/platform-node/NodeServices";
import { it } from "@effect/vitest";
import type { DesktopAppActivationRequest } from "@t3tools/contracts";
import { resolveDesktopAppControlAddress } from "@t3tools/shared/desktopAppControl";
import {
  HostProcessPlatform,
  HostProcessUserId,
  HostProcessWorkingDirectory,
} from "@t3tools/shared/hostProcess";
import * as NetService from "@t3tools/shared/Net";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { DesktopLauncherRegistration } from "@t3tools/contracts";
import { Command } from "effect/unstable/cli";
import { afterEach, describe, expect, vi } from "vite-plus/test";

import { makeCli } from "../bin.ts";

vi.mock("node:child_process", { spy: true });

vi.mock("node:os", async (importOriginal) => {
  const os = await importOriginal<typeof import("node:os")>();
  return { ...os, homedir: vi.fn(os.homedir) };
});

class UnexpectedServerStartup extends Schema.TaggedError<UnexpectedServerStartup>()(
  "UnexpectedServerStartup",
  {},
) {}
const encodeRegistration = Schema.encodeSync(Schema.fromJsonString(DesktopLauncherRegistration));

vi.mock("./server.ts", async (importOriginal) => {
  const server = await importOriginal<typeof import("./server.ts")>();
  return { ...server, runServerCommand: () => Effect.fail(new UnexpectedServerStartup({})) };
});

afterEach(() => {
  vi.mocked(NodeOS.homedir).mockReset();
  vi.mocked(NodeChildProcess.spawn).mockRestore();
});

const runCli = (args: ReadonlyArray<string>, env: Record<string, string> = {}) =>
  Command.runWith(makeCli(), { version: "0.0.0" })(args).pipe(
    Effect.provide(
      Layer.mergeAll(
        NodeServices.layer,
        NetService.layer,
        ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
      ),
    ),
  );

const pathExists = (path: string) =>
  Effect.promise(() =>
    NodeFSP.stat(path).then(
      () => true,
      () => false,
    ),
  );

async function startFakeDesktop(input: {
  readonly baseDir: string;
  readonly stateSubdirectory?: "userdata" | "dev";
  readonly platform: NodeJS.Platform;
  readonly userId: number | undefined;
  readonly reply?: (request: DesktopAppActivationRequest) => unknown;
}) {
  const target = resolveDesktopAppControlAddress({
    stateDir: NodePath.join(input.baseDir, input.stateSubdirectory ?? "userdata"),
    platform: input.platform,
    tempDir: NodeOS.tmpdir(),
    userId: input.userId,
    joinPath: NodePath.join,
  });
  if (target.directory !== null) {
    await NodeFSP.mkdir(target.directory, { recursive: true, mode: 0o700 });
    await NodeFSP.unlink(target.address).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }

  const received: DesktopAppActivationRequest[] = [];
  const server = NodeNet.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      const request = JSON.parse(buffer.slice(0, newline)) as DesktopAppActivationRequest;
      received.push(request);
      const response = input.reply
        ? input.reply(request)
        : {
            version: 1,
            requestId: request.requestId,
            ok: true,
            projectId: "project-1",
            threadId: `thread-${received.length}`,
          };
      socket.end(`${JSON.stringify(response)}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(target.address, resolve);
  });

  return {
    received,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (target.directory !== null) {
        await NodeFSP.unlink(target.address).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      }
    },
  };
}

const fakeDesktop = Effect.fn(function* (
  input: Omit<Parameters<typeof startFakeDesktop>[0], "platform" | "userId">,
) {
  const platform = yield* HostProcessPlatform;
  const userId = yield* HostProcessUserId;
  return yield* Effect.acquireRelease(
    Effect.promise(() => startFakeDesktop({ ...input, platform, userId })),
    (server) => Effect.promise(() => server.close()),
  );
});

const withTempDirectory = <A, E, R>(
  prefix: string,
  use: (root: string) => Effect.Effect<A, E, R>,
) =>
  Effect.acquireUseRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), prefix))),
    use,
    (root) => Effect.promise(() => NodeFSP.rm(root, { recursive: true, force: true })),
  );

describe("t3 directory", () => {
  it.effect("keeps bare t3 on the existing server path", () =>
    Effect.gen(function* () {
      expect(yield* runCli([]).pipe(Effect.flip)).toMatchObject({
        _tag: "UnexpectedServerStartup",
      });
    }),
  );

  it.effect("resolves dot and paths containing spaces", () =>
    withTempDirectory("t3-directory-paths-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, "t3-home");
        const project = NodePath.join(root, "a project's folder");
        yield* Effect.promise(() => NodeFSP.mkdir(project));
        const desktop = yield* fakeDesktop({ baseDir });
        yield* runCli(["."], { T3CODE_HOME: baseDir });
        yield* runCli([project], { T3CODE_HOME: baseDir });
        expect(desktop.received.map((request) => request.workspaceRoot)).toEqual([
          NodePath.resolve("."),
          project,
        ]);
      }).pipe(Effect.scoped),
    ),
  );

  it.effect("fails when no desktop is registered without starting a server", () =>
    withTempDirectory("t3-directory-unregistered-", (root) =>
      Effect.gen(function* () {
        const error = yield* runCli([root], { T3CODE_HOME: root }).pipe(Effect.flip);
        expect(error).toMatchObject({
          _tag: "DesktopAppLaunchError",
          message: expect.stringContaining("Settings"),
        });
        expect(NodeChildProcess.spawn).not.toHaveBeenCalled();
      }),
    ),
  );

  it.effect("never launches or replays an activation after an invalid response", () =>
    withTempDirectory("t3-directory-response-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, "t3-home");
        const desktop = yield* fakeDesktop({ baseDir, reply: () => ({ invalid: true }) });
        expect(yield* runCli([root], { T3CODE_HOME: baseDir }).pipe(Effect.flip)).toMatchObject({
          _tag: "DesktopAppLaunchError",
        });
        expect(desktop.received).toHaveLength(1);
        expect(NodeChildProcess.spawn).not.toHaveBeenCalled();
      }).pipe(Effect.scoped),
    ),
  );

  it.effect(
    "opens explicit directories without starting a server and keeps each request fresh",
    () =>
      withTempDirectory("t3-directory-test-", (root) =>
        Effect.gen(function* () {
          const baseDir = NodePath.join(root, "t3-home");
          const desktop = yield* fakeDesktop({ baseDir });
          yield* runCli([root], { T3CODE_HOME: baseDir });
          yield* runCli([root], { T3CODE_HOME: baseDir });
          expect(desktop.received.map((request) => request.workspaceRoot)).toEqual([root, root]);
          expect(desktop.received[0]?.requestId).not.toBe(desktop.received[1]?.requestId);
        }).pipe(Effect.scoped),
      ),
  );

  it.effect("launches a registered desktop once and waits for activation", () =>
    withTempDirectory("t3-directory-launch-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, "t3-home");
        yield* Effect.promise(() => NodeFSP.mkdir(baseDir));
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            NodePath.join(baseDir, "desktop-launcher.json"),
            encodeRegistration({
              executablePath: "/installed/T3 Code",
              args: [],
              stateDir: NodePath.join(baseDir, "userdata"),
              backendPort: 17834,
            }),
          ),
        );
        const platform = yield* HostProcessPlatform;
        const userId = yield* HostProcessUserId;
        let desktop: Awaited<ReturnType<typeof startFakeDesktop>> | undefined;
        vi.mocked(NodeChildProcess.spawn).mockImplementationOnce(() => {
          const child = new NodeChildProcess.ChildProcess();
          void startFakeDesktop({ baseDir, platform, userId }).then((server) => {
            desktop = server;
            child.emit("spawn");
          });
          return child;
        });
        yield* Effect.addFinalizer(() =>
          Effect.promise(async () => {
            await desktop?.close();
          }),
        );
        yield* runCli([root], { T3CODE_HOME: baseDir });
        expect(NodeChildProcess.spawn).toHaveBeenCalledTimes(1);
        expect(NodeChildProcess.spawn).toHaveBeenCalledWith(
          "/installed/T3 Code",
          [],
          expect.objectContaining({
            env: expect.objectContaining({ T3CODE_PORT: "17834" }),
          }),
        );
        expect(desktop?.received).toHaveLength(1);
      }).pipe(Effect.scoped),
    ),
  );

  it.effect("rejects missing directories before sending an activation", () =>
    withTempDirectory("t3-directory-invalid-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, "t3-home");
        const desktop = yield* fakeDesktop({ baseDir });
        const error = yield* runCli([NodePath.join(root, "missing")], {
          T3CODE_HOME: baseDir,
        }).pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "DesktopWorkspaceInvalidError" });
        expect(desktop.received).toHaveLength(0);
      }).pipe(Effect.scoped),
    ),
  );
});

describe("t3 app", () => {
  it.effect("rejects SSH before it tries to reach a desktop app", () =>
    withTempDirectory("t3-app-ssh-test-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, "missing-t3-home");
        const error = yield* runCli(["app", "--base-dir", baseDir], {
          SSH_CONNECTION: "client server",
        }).pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "DesktopAppSshUnsupportedError",
          message:
            "`t3 app` only controls a desktop app on the same machine. It cannot run over SSH.",
        });
        expect(yield* pathExists(baseDir)).toBe(false);
      }),
    ),
  );

  it.effect("rejects unsupported platforms without creating state", () =>
    withTempDirectory("t3-app-platform-test-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, "missing-t3-home");
        const error = yield* runCli(["app", "--base-dir", baseDir]).pipe(
          Effect.provideService(HostProcessPlatform, "freebsd"),
          Effect.flip,
        );

        expect(error).toMatchObject({
          _tag: "DesktopAppPlatformUnsupportedError",
          platform: "freebsd",
          message: "`t3 app` is not supported on freebsd.",
        });
        expect(yield* pathExists(baseDir)).toBe(false);
      }),
    ),
  );

  it.effect("does not create state when only a server or no desktop app is running", () =>
    withTempDirectory("t3-app-missing-test-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, "missing-t3-home");
        const error = yield* runCli(["app", "--base-dir", baseDir]).pipe(Effect.flip);

        expect(error).toMatchObject({
          _tag: "DesktopAppUnreachableError",
          candidateAddresses: [expect.any(String)],
          workspaceRoot: yield* HostProcessWorkingDirectory,
          message: expect.stringContaining("Could not reach the T3 Code desktop app."),
          cause: { code: "ENOENT" },
        });
        expect(yield* pathExists(baseDir)).toBe(false);
      }),
    ),
  );

  it.effect("uses T3CODE_HOME or --base-dir and sends the default or explicit path", () =>
    withTempDirectory("t3-app-command-test-", (root) =>
      Effect.gen(function* () {
        const baseDir = NodePath.join(root, "t3-home");
        const explicitPath = NodePath.join(root, "project");
        const platform = yield* HostProcessPlatform;
        const workingDirectory = yield* HostProcessWorkingDirectory;
        const desktop = yield* fakeDesktop({ baseDir });

        yield* runCli(["app"], { T3CODE_HOME: baseDir });
        yield* runCli(["app", explicitPath, "--base-dir", baseDir]);

        expect(desktop.received.map((request) => request.workspaceRoot)).toEqual([
          workingDirectory,
          explicitPath,
        ]);
        expect(desktop.received.every((request) => request.platform === platform)).toBe(true);
      }).pipe(Effect.scoped),
    ),
  );

  it.effect("prefers the installed desktop app when a dev desktop is also running", () =>
    withTempDirectory("t3-app-preferred-test-", (root) =>
      Effect.gen(function* () {
        vi.mocked(NodeOS.homedir).mockReturnValue(root);
        const baseDir = NodePath.join(root, ".t3");
        const desktop = yield* fakeDesktop({ baseDir });
        const development = yield* fakeDesktop({ baseDir, stateSubdirectory: "dev" });

        yield* runCli(["app"]);

        expect(desktop.received).toHaveLength(1);
        expect(development.received).toHaveLength(0);
      }).pipe(Effect.scoped),
    ),
  );

  it.effect("finds the dev desktop when the default desktop socket is absent", () =>
    withTempDirectory("t3-app-dev-test-", (root) =>
      Effect.gen(function* () {
        vi.mocked(NodeOS.homedir).mockReturnValue(root);
        const baseDir = NodePath.join(root, ".t3");
        const development = yield* fakeDesktop({ baseDir, stateSubdirectory: "dev" });

        yield* runCli(["app"]);
        yield* runCli(["app"], { T3CODE_HOME: "   " });

        expect(development.received).toHaveLength(2);
        expect(yield* pathExists(baseDir)).toBe(false);
      }).pipe(Effect.scoped),
    ),
  );

  it.effect("never searches a dev state directory for an explicit T3 home", () =>
    withTempDirectory("t3-app-explicit-test-", (root) =>
      Effect.gen(function* () {
        vi.mocked(NodeOS.homedir).mockReturnValue(root);
        const baseDir = NodePath.join(root, ".t3");
        const development = yield* fakeDesktop({ baseDir, stateSubdirectory: "dev" });

        const flagError = yield* runCli(["app", "--base-dir", baseDir]).pipe(Effect.flip);
        const envError = yield* runCli(["app"], { T3CODE_HOME: baseDir }).pipe(Effect.flip);

        expect(flagError).toMatchObject({ _tag: "DesktopAppUnreachableError" });
        expect(envError).toMatchObject({ _tag: "DesktopAppUnreachableError" });
        expect(development.received).toHaveLength(0);
      }).pipe(Effect.scoped),
    ),
  );

  for (const responseKind of ["failure", "invalid"] as const) {
    it.effect(`never falls back after the default desktop sends a ${responseKind} response`, () =>
      withTempDirectory("t3-app-response-test-", (root) =>
        Effect.gen(function* () {
          vi.mocked(NodeOS.homedir).mockReturnValue(root);
          const baseDir = NodePath.join(root, ".t3");
          const desktop = yield* fakeDesktop({
            baseDir,
            reply: (request) =>
              responseKind === "failure"
                ? {
                    version: 1,
                    requestId: request.requestId,
                    ok: false,
                    code: "project-create-failed",
                    message: "The project path is not available.",
                  }
                : { invalid: true },
          });
          const development = yield* fakeDesktop({ baseDir, stateSubdirectory: "dev" });

          const error = yield* runCli(["app"]).pipe(Effect.flip);

          expect(desktop.received).toHaveLength(1);
          expect(development.received).toHaveLength(0);
          if (responseKind === "failure") {
            expect(error).toMatchObject({
              _tag: "DesktopAppRequestFailedError",
              code: "project-create-failed",
              requestId: desktop.received[0]?.requestId,
              workspaceRoot: yield* HostProcessWorkingDirectory,
              message: expect.stringContaining("project-create-failed"),
              cause: {
                ok: false,
                code: "project-create-failed",
                message: "The project path is not available.",
              },
            });
          } else {
            expect(error).toMatchObject({
              _tag: "DesktopAppUnreachableError",
              cause: { message: "The desktop app response is invalid." },
            });
          }
        }).pipe(Effect.scoped),
      ),
    );
  }
});
