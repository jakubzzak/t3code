import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { NodeId, ProviderThreadId, RunId, ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";
import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as CheckpointDiffQuery from "../checkpointing/CheckpointDiffQuery.ts";
import * as ServerConfig from "../config.ts";
import * as VcsProcess from "../vcs/VcsProcess.ts";
import * as VcsDriverRegistry from "../vcs/VcsDriverRegistry.ts";
import * as CheckpointService from "./CheckpointService.ts";
import { isCheckpointRestoreIsolated } from "./CheckpointRestoreSafety.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

const vcsLayer = VcsProcess.layer.pipe(Layer.provide(NodeServices.layer));
const storeLayer = CheckpointStore.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      VcsDriverRegistry.layer.pipe(Layer.provide(vcsLayer)),
      ServerConfig.ServerConfig.layerTest(process.cwd(), { prefix: "t3-move-checkpoints-" }),
    ),
  ),
  Layer.provide(NodeServices.layer),
);
const layer = CheckpointService.layer.pipe(
  Layer.provideMerge(storeLayer),
  Layer.provideMerge(vcsLayer),
  Layer.provideMerge(IdAllocator.layer),
  Layer.provideMerge(NodeServices.layer),
);

it.effect(
  "keeps real repository diffs and blocks restoring a source checkpoint into the destination",
  () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const vcs = yield* VcsProcess.VcsProcess;
      const service = yield* CheckpointService.CheckpointServiceV2;
      const parent = yield* fs.makeTempDirectoryScoped({ prefix: "t3-project-move-checkpoints-" });
      const source = path.join(parent, "source");
      const destination = path.join(parent, "destination");
      const git = (cwd: string, args: ReadonlyArray<string>) =>
        vcs.run({
          operation: "ProjectMoveCheckpoints.test.git",
          command: "git",
          cwd,
          args,
          timeoutMs: 10_000,
        });
      for (const cwd of [source, destination]) {
        yield* fs.makeDirectory(cwd);
        yield* git(cwd, ["init"]);
        yield* git(cwd, ["config", "user.name", "Test"]);
        yield* git(cwd, ["config", "user.email", "test@example.com"]);
        yield* fs.writeFileString(path.join(cwd, "file.txt"), "baseline\n");
        yield* git(cwd, ["add", "."]);
        yield* git(cwd, ["commit", "-m", "baseline"]);
      }
      const threadId = ThreadId.make("moving-checkpoints");
      const now = DateTime.makeUnsafe("2026-11-01T00:00:00Z");
      const input = {
        threadId,
        runId: RunId.make("move-run-1"),
        rootNodeId: NodeId.make("move-node-1"),
        providerThreadId: ProviderThreadId.make("move-provider-thread"),
        cwd: source,
        createdAt: now,
        existingScopes: [],
      };
      const sourceScope = yield* service.prepareRootRunScope(input);
      yield* service.captureBaseline({ scope: sourceScope, ordinalWithinScope: 0 });
      const sourceBaseline = yield* service.materializeBaselineCheckpoint({
        scope: sourceScope,
        ordinalWithinScope: 0,
      });
      yield* fs.writeFileString(path.join(source, "file.txt"), "source edit\n");
      const first = yield* service.capture({
        scope: sourceScope,
        runId: input.runId,
        nodeId: input.rootNodeId,
        ordinalWithinScope: 1,
        appRunOrdinal: 1,
        capturedAt: now,
      });
      const destinationScope = yield* service.prepareRootRunScope({
        ...input,
        cwd: destination,
        runId: RunId.make("move-run-2"),
        rootNodeId: NodeId.make("move-node-2"),
        existingScopes: [sourceScope],
      });
      assert.notEqual(destinationScope.id, sourceScope.id);
      yield* service.captureBaseline({ scope: destinationScope, ordinalWithinScope: 1 });
      const destinationBaseline = yield* service.materializeBaselineCheckpoint({
        scope: destinationScope,
        ordinalWithinScope: 1,
      });
      yield* fs.writeFileString(path.join(destination, "file.txt"), "destination edit\n");
      const second = yield* service.capture({
        scope: destinationScope,
        runId: destinationScope.runId,
        nodeId: input.rootNodeId,
        ordinalWithinScope: 2,
        appRunOrdinal: 2,
        capturedAt: now,
      });
      const query = yield* CheckpointDiffQuery.CheckpointDiffQuery.pipe(
        Effect.provide(
          CheckpointDiffQuery.layer.pipe(
            Layer.provide(
              Layer.mock(ThreadManagement.ThreadManagementService)({
                getCheckpointContext: () =>
                  Effect.succeed({
                    runs: [
                      { id: input.runId, ordinal: 1, status: "completed" },
                      { id: destinationScope.runId!, ordinal: 2, status: "completed" },
                    ],
                    checkpointScopes: [sourceScope, destinationScope],
                    checkpoints: [sourceBaseline, first, destinationBaseline, second],
                  }),
              }),
            ),
          ),
        ),
      );
      const oldDiff = yield* query.getTurnDiff({ threadId, fromTurnCount: 0, toTurnCount: 1 });
      assert.include(oldDiff.diff, "+source edit");
      assert.notInclude(oldDiff.diff, "+destination edit");
      for (const fromTurnCount of [0, 1]) {
        const newDiff = yield* query.getTurnDiff({ threadId, fromTurnCount, toTurnCount: 2 });
        assert.include(newDiff.diff, "+destination edit");
        assert.notInclude(newDiff.diff, "+source edit");
      }
      const projections = yield* ProjectionStore.ProjectionStoreV2.pipe(
        Effect.provide(
          Layer.mock(ProjectionStore.ProjectionStoreV2)({
            getShellSnapshot: () =>
              Effect.succeed({
                schemaVersion: 2,
                snapshotSequence: 0,
                threads: [],
                archivedThreads: [],
              }),
          }),
        ),
      );
      const projects = yield* ProjectStore.ProjectStoreV2.pipe(
        Effect.provide(Layer.mock(ProjectStore.ProjectStoreV2)({})),
      );
      const dependencies = { fileSystem: fs, path, projections, projects };
      assert.isFalse(
        yield* isCheckpointRestoreIsolated(
          { id: threadId, worktreePath: destination },
          sourceScope,
          dependencies,
        ),
      );
      assert.isTrue(
        yield* isCheckpointRestoreIsolated(
          { id: threadId, worktreePath: destination },
          destinationScope,
          dependencies,
        ),
      );
      assert.equal(yield* fs.readFileString(path.join(source, "file.txt")), "source edit\n");
      assert.equal(
        yield* fs.readFileString(path.join(destination, "file.txt")),
        "destination edit\n",
      );
    }).pipe(Effect.scoped, Effect.provide(layer)),
);
