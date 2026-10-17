import { assert, it } from "@effect/vitest";
import {
  ThreadId,
  ProjectId,
  ProviderInstanceId,
  ThreadCleanupError,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Cleanup from "./ThreadCleanup.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";
import { EffectOutboxV2 } from "./EffectOutbox.ts";
import * as Terminal from "../terminal/Manager.ts";
import * as Preview from "../preview/Manager.ts";
import * as Processes from "../process/ThreadProcesses.ts";
import { finishThreadCleanup, isThreadClosing } from "../process/threadResourceLease.ts";
const now = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
function shell(overrides: Partial<OrchestrationV2ThreadShell> = {}): OrchestrationV2ThreadShell {
  return {
    id: ThreadId.make("thread-1"),
    projectId: ProjectId.make("project-1"),
    title: "Thread",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: {
      rootThreadId: ThreadId.make("thread-1"),
      parentThreadId: null,
      relationshipToParent: null,
    },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    lastVisitedAt: null,
    deletedAt: null,
    branch: null,
    linkedPullRequest: null,
    status: "idle",
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    latestUserMessageAt: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

const threadId = ThreadId.make("thread-1");
const processEntry = { pid: 1234, ppid: 1, name: "detached server", startTimeMs: 123000 };
const finished = (service: Cleanup.ThreadCleanup["Service"]) =>
  service.subscribe(threadId).pipe(
    Stream.filter((state) => state !== null && state.status !== "closing"),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );
function testLayer(
  options: {
    thread?: OrchestrationV2ThreadShell;
    getThread?: ThreadManagementService["Service"]["getThreadShell"];
    list?: Processes.ThreadProcesses["Service"]["list"];
    stop?: Processes.ThreadProcesses["Service"]["stop"];
    dispatch?: ThreadManagementService["Service"]["dispatch"];
  } = {},
) {
  return Cleanup.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(ThreadManagementService)({
          getThreadShell: options.getThread ?? (() => Effect.succeed(options.thread ?? shell())),
          dispatch: options.dispatch ?? (() => Effect.succeed({ sequence: 1, storedEvents: [] })),
        }),
        Layer.mock(EffectOutboxV2)({
          listByCommandId: () => Effect.succeed([]),
          awaitSettled: () => Effect.void,
        }),
        Layer.mock(Terminal.TerminalManager)({
          listForThread: () => Effect.succeed([]),
          close: () => Effect.void,
        }),
        Layer.mock(Preview.PreviewManager)({
          list: () => Effect.succeed({ serverEpoch: "test", revision: 0, sessions: [] }),
          close: () => Effect.void,
        }),
        Layer.succeed(Processes.ThreadProcesses, {
          list: options.list ?? (() => Effect.succeed([])),
          stop: options.stop ?? (() => Effect.void),
        }),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );
}
it.effect("waits for verified process exit before settling and unlocks after completion", () =>
  Effect.gen(function* () {
    const exit = yield* Deferred.make<void>();
    const stopping = yield* Deferred.make<void>();
    let alive = true;
    const commands: string[] = [];
    yield* Effect.gen(function* () {
      const cleanup = yield* Cleanup.ThreadCleanup;
      yield* cleanup.start({ threadId, interruptAgent: true });
      yield* Deferred.await(stopping);
      assert.isTrue(isThreadClosing(threadId));
      assert.deepEqual(commands, ["thread.stop"]);
      yield* Deferred.succeed(exit, undefined);
      assert.equal((yield* finished(cleanup))!.status, "complete");
      assert.deepEqual(commands, ["thread.stop", "thread.settle"]);
      assert.isFalse(isThreadClosing(threadId));
    }).pipe(
      Effect.provide(
        testLayer({
          list: () => Effect.succeed(alive ? [processEntry] : []),
          stop: () =>
            Deferred.succeed(stopping, undefined).pipe(
              Effect.andThen(Deferred.await(exit)),
              Effect.andThen(
                Effect.sync(() => {
                  alive = false;
                }),
              ),
            ),
          dispatch: (command) => {
            commands.push(command.type);
            return Effect.succeed({ sequence: commands.length, storedEvents: [] });
          },
        }),
      ),
    );
  }),
);
it.effect("retains failed process identities for retry and never settles early", () =>
  Effect.gen(function* () {
    let attempts = 0;
    let alive = true;
    const commands: string[] = [];
    yield* Effect.gen(function* () {
      const cleanup = yield* Cleanup.ThreadCleanup;
      yield* cleanup.start({ threadId, interruptAgent: true });
      assert.equal((yield* finished(cleanup))!.status, "failed");
      assert.isFalse(commands.includes("thread.settle"));
      yield* cleanup.start({ threadId, interruptAgent: true });
      assert.equal((yield* finished(cleanup))!.status, "complete");
      assert.equal(attempts, 2);
    }).pipe(
      Effect.provide(
        testLayer({
          list: () => Effect.succeed(alive ? [processEntry] : []),
          stop: () =>
            Effect.suspend(() => {
              if (attempts++ === 0)
                return Effect.fail(new ThreadCleanupError({ threadId, detail: "Could not stop" }));
              alive = false;
              return Effect.void;
            }),
          dispatch: (command) => {
            commands.push(command.type);
            return Effect.succeed({ sequence: commands.length, storedEvents: [] });
          },
        }),
      ),
      Effect.ensuring(Effect.sync(() => finishThreadCleanup(threadId))),
    );
  }),
);
it.effect("requires confirmation for a running agent before taking a cleanup lease", () =>
  Effect.gen(function* () {
    const cleanup = yield* Cleanup.ThreadCleanup;
    const result = yield* Effect.flip(cleanup.start({ threadId, interruptAgent: false }));
    assert.isTrue(result.confirmationRequired);
    assert.isFalse(isThreadClosing(threadId));
  }).pipe(Effect.provide(testLayer({ thread: shell({ status: "running" }) }))),
);
it.effect("rejects stale automatic cleanup before stopping resources", () =>
  Effect.gen(function* () {
    const cleanup = yield* Cleanup.ThreadCleanup;
    const result = yield* Effect.flip(
      cleanup.start(
        { threadId, interruptAgent: false },
        { snapshotAt: DateTime.makeUnsafe(0), settledAt: now },
      ),
    );
    assert.include(result.message, "changed");
    assert.isFalse(isThreadClosing(threadId));
  }).pipe(Effect.provide(testLayer())),
);
it.effect("does not lock the chat when the resource monitor is unavailable", () =>
  Effect.gen(function* () {
    const cleanup = yield* Cleanup.ThreadCleanup;
    yield* Effect.flip(cleanup.start({ threadId, interruptAgent: true }));
    assert.isFalse(isThreadClosing(threadId));
  }).pipe(
    Effect.provide(
      testLayer({
        list: () =>
          Effect.fail(new ThreadCleanupError({ threadId, detail: "Monitor unavailable" })),
      }),
    ),
  ),
);

it.effect(
  "rechecks activity after monitor preflight and skips automatic cleanup without locking",
  () =>
    Effect.gen(function* () {
      let current = shell();
      const layer = testLayer({
        getThread: () => Effect.sync(() => current),
        list: () =>
          Effect.sync(() => {
            current = shell({ updatedAt: DateTime.add(now, { seconds: 1 }) });
            return [];
          }),
      });
      yield* Effect.gen(function* () {
        const cleanup = yield* Cleanup.ThreadCleanup;
        yield* Effect.flip(
          cleanup.start({ threadId, interruptAgent: false }, { snapshotAt: now, settledAt: now }),
        );
        assert.isFalse(isThreadClosing(threadId));
      }).pipe(Effect.provide(layer));
    }),
);
