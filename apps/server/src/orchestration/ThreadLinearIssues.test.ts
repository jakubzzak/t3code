import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Path from "effect/Path";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as TerminalManager from "../terminal/Manager.ts";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ServerConfig } from "../config.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import * as GitVcsDriver from "../vcs/GitVcsDriver.ts";
import { OrchestrationLayerLive } from "./runtimeLayer.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import * as ThreadLinearIssues from "./ThreadLinearIssues.ts";

const makeTestLayer = (
  runForThread: ProjectSetupScriptRunner.ProjectSetupScriptRunner["Service"]["runForThread"] = (
    input,
  ) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const file = path.join(input.worktreePath, "setup-runs.txt");
      const before = (yield* fs.exists(file)) ? yield* fs.readFileString(file) : "";
      yield* fs.writeFileString(file, before + "setup\n");
      return { status: "no-script" as const };
    }).pipe(Effect.orDie, Effect.provide(NodeServices.layer)),
  close: TerminalManager.TerminalManager["Service"]["close"] = () => Effect.void,
) =>
  ThreadLinearIssues.layer.pipe(
    Layer.provide(
      Layer.succeed(ProjectSetupScriptRunner.ProjectSetupScriptRunner, { runForThread }),
    ),
    Layer.provide(Layer.mock(TerminalManager.TerminalManager)({ close })),
    Layer.provideMerge(OrchestrationLayerLive),
    Layer.provideMerge(GitVcsDriver.layer),
    Layer.provide(
      Layer.mock(ServerSettingsService)({
        getSettings: Effect.succeed({
          ...DEFAULT_SERVER_SETTINGS,
          linearWorkspace: "acme",
          worktreeSubmodules: "recursive",
          projectSettingsOverrides: { "linear-project": { worktreeSubmodules: "none" } },
        }),
      }),
    ),
    Layer.provide(
      Layer.succeed(RepositoryIdentityResolver.RepositoryIdentityResolver, {
        resolve: () => Effect.succeed(null),
      }),
    ),
    Layer.provide(SqlitePersistenceMemory),
    Layer.provideMerge(ServerConfig.layerTest(process.cwd(), { prefix: "t3-linear-service-" })),
    Layer.provideMerge(NodeServices.layer),
  );
const seed = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const linear = yield* ThreadLinearIssues.ThreadLinearIssues;
  const cwd = yield* fs.makeTempDirectoryScoped();
  yield* git.execute({ cwd, args: ["init", "-b", "main"], operation: "test" });
  yield* git.execute({
    cwd,
    args: [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.com",
      "commit",
      "--allow-empty",
      "-m",
      "Initial",
    ],
    operation: "test",
  });
  const projectId = ProjectId.make("linear-project");
  const previousId = ThreadId.make("previous");
  const currentId = ThreadId.make("current");
  const createdAt = "2026-01-01T00:00:00Z";
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("project"),
    projectId,
    title: "Project",
    workspaceRoot: cwd,
    createdAt,
  });
  for (const threadId of [previousId, currentId])
    yield* engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create-${threadId}`),
      projectId,
      threadId,
      title: threadId,
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      createdAt,
    });
  const issue = {
    id: "issue-1",
    identifier: "ENG-123",
    title: "Fix login",
    workspace: "acme",
    url: "https://linear.app/acme/issue/ENG-123",
    branchName: "eng-123-fix-login",
  };
  const input = {
    issue,
    baseRef: "main",
    expectedWorktreePath: null,
    expectedIssueId: null,
    takeoverThreadIds: [],
  };
  return { fs, git, cwd, linear, engine, snapshots, previousId, currentId, issue, input };
});
it.layer(makeTestLayer())("Linear chat setup", (it) => {
  it.effect(
    "links, resolves an active chat conflict, settles only on takeover, and unlinks without removing files",
    () =>
      Effect.gen(function* () {
        const { fs, linear, engine, snapshots, previousId, currentId, issue, input } = yield* seed;
        const first = yield* linear.select({
          ...input,
          commandId: CommandId.make("first"),
          threadId: previousId,
        });
        expect(first.status).toBe("linked");
        const conflict = yield* linear.select({
          ...input,
          commandId: CommandId.make("conflict"),
          threadId: currentId,
        });
        expect(conflict.status).toBe("conflict");
        expect(conflict.conflicts[0]?.threadId).toBe(previousId);
        const before = yield* snapshots.getShellSnapshot();
        expect(before.threads.find((thread) => thread.id === previousId)?.settledAt).toBeNull();
        expect(before.threads.find((thread) => thread.id === currentId)?.worktreePath).toBeNull();
        const takeover = yield* linear.select({
          ...input,
          commandId: CommandId.make("takeover"),
          threadId: currentId,
          takeoverThreadIds: [previousId],
        });
        expect(takeover.status).toBe("linked");
        expect(takeover.worktreePath).toBe(first.worktreePath);
        const path = yield* Path.Path;
        expect(yield* fs.readFileString(path.join(first.worktreePath, "setup-runs.txt"))).toBe(
          "setup\n",
        );
        const after = yield* snapshots.getSnapshot();
        expect(after.threads.find((thread) => thread.id === previousId)?.settledOverride).toBe(
          "settled",
        );
        expect(after.threads.find((thread) => thread.id === currentId)?.linkedLinearIssue).toEqual(
          issue,
        );
        yield* engine.dispatch({
          type: "thread.meta.update",
          commandId: CommandId.make("unlink"),
          threadId: currentId,
          linkedLinearIssue: null,
        });
        const unlinked = yield* snapshots.getShellSnapshot();
        expect(
          unlinked.threads.find((thread) => thread.id === currentId)?.linkedLinearIssue,
        ).toBeNull();
        expect(unlinked.threads.find((thread) => thread.id === currentId)?.worktreePath).toBe(
          first.worktreePath,
        );
        expect(yield* fs.exists(first.worktreePath)).toBe(true);
      }),
  );
});
it.effect("uses the project's submodule override instead of the environment default", () =>
  Effect.gen(function* () {
    const { fs, git, cwd, linear, previousId, input } = yield* seed;
    const path = yield* Path.Path;
    const head = yield* git.execute({ cwd, args: ["rev-parse", "HEAD"], operation: "test" });
    yield* fs.writeFileString(
      path.join(cwd, ".gitmodules"),
      '[submodule "shared"]\npath = shared\nurl = /nonexistent/linear-submodule.git\n',
    );
    yield* git.execute({ cwd, args: ["add", ".gitmodules"], operation: "test" });
    yield* git.execute({
      cwd,
      args: ["update-index", "--add", "--cacheinfo", `160000,${head.stdout.trim()},shared`],
      operation: "test",
    });
    yield* git.execute({
      cwd,
      args: [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "-m",
        "submodule",
      ],
      operation: "test",
    });
    const result = yield* linear.select({
      ...input,
      threadId: previousId,
      commandId: CommandId.make("submodules"),
    });
    // Initializing even an unreachable submodule registers its URL. The project
    // opts out, so no init or network access should happen at all.
    const registered = yield* git.execute({
      cwd: result.worktreePath,
      args: ["config", "--get", "submodule.shared.url"],
      operation: "test",
      allowNonZeroExit: true,
    });
    expect(registered.exitCode).toBe(1);
  }).pipe(Effect.provide(makeTestLayer())),
);

for (const async of [false, true]) {
  it.effect(`honors async=${async} when preparing the checkout before its first turn`, () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      const done = yield* Deferred.make<ProjectSetupScriptRunner.ProjectSetupScriptCompletion>();
      const layer = makeTestLayer((input) =>
        Deferred.succeed(started, undefined).pipe(
          Effect.as({
            status: "started" as const,
            scriptId: "setup",
            scriptName: "Install",
            scriptCommand: "install",
            terminalId: input.preferredTerminalId!,
            cwd: input.worktreePath,
            async,
            completion: Deferred.await(done),
          }),
        ),
      );
      yield* Effect.gen(function* () {
        const { linear, snapshots, previousId, input } = yield* seed;
        const selecting = yield* linear
          .select({ ...input, threadId: previousId, commandId: CommandId.make("setup") })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        if (async) {
          expect((yield* Fiber.join(selecting)).status).toBe("linked");
        } else {
          expect(
            (yield* snapshots.getShellSnapshot()).threads.find((thread) => thread.id === previousId)
              ?.linkedLinearIssue,
          ).toBeNull();
        }
        yield* Deferred.succeed(done, { exitCode: 0, durationMs: 1 });
        expect((yield* Fiber.join(selecting)).status).toBe("linked");
      }).pipe(Effect.provide(layer));
    }),
  );
}

it.effect(
  "cancelling synchronous setup closes its terminal and preserves the chat's previous context",
  () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      let closed = false;
      let unsubscribed = false;
      const layer = makeTestLayer(
        (input) =>
          Deferred.succeed(started, undefined).pipe(
            Effect.as({
              status: "started" as const,
              scriptId: "setup",
              scriptName: "Install",
              scriptCommand: "install",
              terminalId: input.preferredTerminalId!,
              cwd: input.worktreePath,
              async: false,
              completion: Effect.never.pipe(
                Effect.ensuring(
                  Effect.sync(() => {
                    unsubscribed = true;
                  }),
                ),
              ),
            }),
          ),
        () =>
          Effect.sync(() => {
            closed = true;
          }),
      );
      yield* Effect.gen(function* () {
        const { linear, snapshots, previousId, input } = yield* seed;
        const selecting = yield* linear
          .select({ ...input, threadId: previousId, commandId: CommandId.make("cancel-setup") })
          .pipe(Effect.forkScoped);
        yield* Deferred.await(started);
        yield* Fiber.interrupt(selecting);
        expect(closed).toBe(true);
        expect(unsubscribed).toBe(true);
        const thread = (yield* snapshots.getShellSnapshot()).threads.find(
          (item) => item.id === previousId,
        );
        expect(thread?.worktreePath).toBeNull();
        expect(thread?.linkedLinearIssue).toBeNull();
      }).pipe(Effect.provide(layer));
    }),
);

for (const exitCode of [1, null]) {
  it.effect(
    `keeps the worktree and records failed setup when its terminal exits with ${exitCode}`,
    () =>
      Effect.gen(function* () {
        const { linear, snapshots, previousId, input, fs } = yield* seed;
        const result = yield* linear.select({
          ...input,
          threadId: previousId,
          commandId: CommandId.make("failed-setup"),
        });
        expect(result.status).toBe("linked");
        expect(yield* fs.exists(result.worktreePath)).toBe(true);
        const thread = (yield* snapshots.getSnapshot()).threads.find(
          (item) => item.id === previousId,
        );
        expect(thread?.activities.some((activity) => activity.kind === "setup-script.failed")).toBe(
          true,
        );
      }).pipe(
        Effect.provide(
          makeTestLayer((input) =>
            Effect.succeed({
              status: "started" as const,
              scriptId: "setup",
              scriptName: "Install",
              scriptCommand: "install",
              terminalId: input.preferredTerminalId!,
              cwd: input.worktreePath,
              async: false,
              completion: Effect.succeed({ exitCode, durationMs: 1 }),
            }),
          ),
        ),
      ),
  );
}

it.effect("records a setup launch failure without discarding the new worktree", () =>
  Effect.gen(function* () {
    const { linear, snapshots, previousId, input, fs } = yield* seed;
    const result = yield* linear.select({
      ...input,
      threadId: previousId,
      commandId: CommandId.make("launch-failed"),
    });
    expect(result.status).toBe("linked");
    expect(yield* fs.exists(result.worktreePath)).toBe(true);
    const thread = (yield* snapshots.getSnapshot()).threads.find((item) => item.id === previousId);
    expect(thread?.activities.some((activity) => activity.kind === "setup-script.failed")).toBe(
      true,
    );
  }).pipe(
    Effect.provide(
      makeTestLayer((input) =>
        Effect.fail(
          new ProjectSetupScriptRunner.ProjectSetupScriptOperationError({
            ...input,
            operation: "openTerminal",
            cause: new Error("terminal unavailable"),
          }),
        ),
      ),
    ),
  ),
);
