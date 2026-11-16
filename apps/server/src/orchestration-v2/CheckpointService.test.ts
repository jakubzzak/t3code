import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it, vi } from "@effect/vitest";
import {
  CheckpointScopeId,
  NodeId,
  ProviderThreadId,
  RunId,
  ThreadId,
  type OrchestrationV2CheckpointScope,
  VcsProcessTimeoutError,
  VcsUnsupportedOperationError,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as CheckpointStore from "../checkpointing/CheckpointStore.ts";
import * as CheckpointService from "./CheckpointService.ts";
import * as IdAllocator from "@t3tools/provider-core/server/IdAllocator";

it.effect(
  "skips unsupported baseline and turn checkpoints without swallowing capture failures",
  () =>
    Effect.gen(function* () {
      const scope: OrchestrationV2CheckpointScope = {
        id: CheckpointScopeId.make("checkpoint-scope:capture-failure"),
        threadId: ThreadId.make("thread:capture-failure"),
        runId: RunId.make("run:capture-failure:1"),
        nodeId: NodeId.make("node:capture-failure:1"),
        parentScopeId: null,
        providerThreadId: ProviderThreadId.make("provider-thread:capture-failure"),
        kind: "root_run",
        ordinalWithinParent: 0,
        advancesAppRunCount: true,
        cwd: "/repo/ignored",
        createdAt: DateTime.makeUnsafe("2026-07-28T00:00:00.000Z"),
      };
      for (const captureError of [
        new VcsProcessTimeoutError({
          operation: "test.capture",
          command: "git",
          cwd: scope.cwd,
          timeoutMs: 30000,
        }),
        new VcsUnsupportedOperationError({
          operation: "test.capture",
          kind: "git",
          detail: "The workspace directory is ignored by its Git repository.",
        }),
      ]) {
        const layerTest = CheckpointService.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              IdAllocator.layer,
              Layer.mock(CheckpointStore.CheckpointStore)({
                isGitRepository: () => Effect.succeed(true),
                hasCheckpointRef: () => Effect.succeed(false),
                captureCheckpoint: () => Effect.fail(captureError),
              }),
            ),
          ),
          Layer.provideMerge(NodeCrypto.layer),
        );
        yield* Effect.gen(function* () {
          const checkpoints = yield* CheckpointService.CheckpointServiceV2;
          const baseline = yield* Effect.result(
            checkpoints.captureBaseline({ scope, ordinalWithinScope: 0 }),
          );
          const checkpoint = yield* checkpoints.capture({
            scope,
            ordinalWithinScope: 1,
            runId: scope.runId!,
            nodeId: scope.nodeId!,
            appRunOrdinal: 1,
            capturedAt: scope.createdAt,
          });

          assert.deepEqual(
            { baseline: baseline._tag, turn: checkpoint.status, files: checkpoint.files },
            captureError._tag === "VcsUnsupportedOperationError"
              ? { baseline: "Success", turn: "missing", files: [] }
              : { baseline: "Failure", turn: "error", files: [] },
          );
          if (baseline._tag === "Failure") {
            assert.strictEqual(baseline.failure.cause, captureError);
          } else {
            const materialized = yield* checkpoints.materializeBaselineCheckpoint({
              scope,
              ordinalWithinScope: 0,
            });
            assert.strictEqual(materialized.status, "missing");
          }
        }).pipe(Effect.provide(layerTest));
      }
    }),
);

it.effect("settles checkpoints as missing without capture when Git is unavailable", () => {
  const scope: OrchestrationV2CheckpointScope = {
    id: CheckpointScopeId.make("disabled-git-scope"),
    threadId: ThreadId.make("disabled-git-thread"),
    runId: RunId.make("disabled-git-run"),
    nodeId: NodeId.make("disabled-git-node"),
    parentScopeId: null,
    providerThreadId: ProviderThreadId.make("disabled-git-provider"),
    kind: "root_run",
    ordinalWithinParent: 0,
    advancesAppRunCount: true,
    cwd: "/plain-workspace",
    createdAt: DateTime.makeUnsafe("2026-10-19T12:00:00Z"),
  };
  const capture = vi.fn(() => Effect.die("Unexpected checkpoint capture"));
  const lookup = vi.fn(() => Effect.die("Unexpected Git ref lookup"));
  const layer = CheckpointService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        IdAllocator.layer,
        Layer.mock(CheckpointStore.CheckpointStore)({
          isGitRepository: () => Effect.succeed(false),
          captureCheckpoint: capture,
          hasCheckpointRef: lookup,
        }),
      ),
    ),
    Layer.provide(NodeCrypto.layer),
  );
  return Effect.gen(function* () {
    const checkpoints = yield* CheckpointService.CheckpointServiceV2;
    yield* checkpoints.captureBaseline({ scope, ordinalWithinScope: 0 });
    const baseline = yield* checkpoints.materializeBaselineCheckpoint({
      scope,
      ordinalWithinScope: 0,
    });
    const result = yield* checkpoints.capture({
      scope,
      ordinalWithinScope: 1,
      runId: scope.runId!,
      nodeId: scope.nodeId!,
      appRunOrdinal: 1,
      capturedAt: scope.createdAt,
    });
    assert.equal(baseline.status, "missing");
    assert.equal(result.status, "missing");
    assert.deepEqual(result.files, []);
    assert.equal(capture.mock.calls.length, 0);
    assert.equal(lookup.mock.calls.length, 0);
  }).pipe(Effect.provide(layer));
});

it.effect("keeps historical workspace scope identity across project moves and returns", () =>
  Effect.gen(function* () {
    const service = yield* CheckpointService.CheckpointServiceV2;
    const input = {
      threadId: ThreadId.make("moving-thread"),
      runId: RunId.make("moving-run-1"),
      rootNodeId: NodeId.make("moving-node-1"),
      providerThreadId: ProviderThreadId.make("moving-provider-thread"),
      cwd: "/source",
      createdAt: DateTime.makeUnsafe("2026-11-01T00:00:00Z"),
      existingScopes: [],
    };
    const source = yield* service.prepareRootRunScope(input);
    const destination = yield* service.prepareRootRunScope({
      ...input,
      cwd: "/destination",
      runId: RunId.make("moving-run-2"),
      existingScopes: [source],
    });
    assert.notEqual(destination.id, source.id);
    const next = yield* service.prepareRootRunScope({
      ...input,
      cwd: "/destination",
      runId: RunId.make("moving-run-3"),
      existingScopes: [source, destination],
    });
    assert.equal(next.id, destination.id);
    const back = yield* service.prepareRootRunScope({
      ...input,
      runId: RunId.make("moving-run-4"),
      existingScopes: [source, next],
    });
    assert.equal(back.id, source.id);
    assert.equal(source.cwd, "/source");
    assert.equal(destination.cwd, "/destination");
  }).pipe(
    Effect.provide(
      CheckpointService.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            IdAllocator.layer,
            NodeCrypto.layer,
            Layer.mock(CheckpointStore.CheckpointStore)({}),
          ),
        ),
      ),
    ),
  ),
);
