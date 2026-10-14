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

const TestLayer = ThreadLinearIssues.layer.pipe(
  Layer.provideMerge(OrchestrationLayerLive),
  Layer.provideMerge(GitVcsDriver.layer),
  Layer.provide(
    Layer.mock(ServerSettingsService)({
      getSettings: Effect.succeed({ ...DEFAULT_SERVER_SETTINGS, linearWorkspace: "acme" }),
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
it.layer(TestLayer)("Linear chat setup", (it) => {
  it.effect(
    "links, resolves an active chat conflict, settles only on takeover, and unlinks without removing files",
    () =>
      Effect.gen(function* () {
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
