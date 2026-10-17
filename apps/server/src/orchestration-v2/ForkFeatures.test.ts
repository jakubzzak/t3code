import { beginThreadCleanup, finishThreadCleanup } from "../process/threadResourceLease.ts";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  MessageId,
  EventId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";
const instanceId = ProviderInstanceId.make("codex");
const modelSelection = { instanceId, model: "gpt-5.4" };
const database = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  database,
  ProjectionStore.layer.pipe(Layer.provide(database)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "fork-features" },
    ProviderAdapterRegistry.layerFromAdapters([
      {
        instanceId,
        driver: ProviderDriverKind.make("codex"),
        getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
        planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
        openSession: () => Effect.die("No provider required"),
      },
    ]),
    { databaseLayer: database, runEffectWorker: false },
  ),
);
const issue = {
  id: "issue-1",
  identifier: "ENG-123",
  title: "Fix login",
  workspace: "acme",
  url: "https://linear.app/acme/issue/ENG-123",
  branchName: "eng-123-fix-login",
};
const create = Effect.fnUntraced(function* (id: string) {
  const engine = yield* Orchestrator.OrchestratorV2;
  const threadId = ThreadId.make(id);
  yield* engine.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`create:${id}`),
    threadId,
    projectId: ProjectId.make("project"),
    title: id,
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  return threadId;
});
it.effect(
  "links a Linear worktree, rejects changed ownership, and atomically settles an approved takeover",
  () =>
    Effect.gen(function* () {
      const engine = yield* Orchestrator.OrchestratorV2;
      const first = yield* create("first");
      const second = yield* create("second");
      const input = {
        type: "thread.linear-issue.select" as const,
        issue,
        baseRef: "main",
        worktreePath: "/tmp/linear-feature-worktree",
        expectedWorktreePath: null,
        expectedIssueId: null,
        takeoverThreadIds: [],
      };
      yield* engine.dispatch({
        ...input,
        commandId: CommandId.make("link-first"),
        threadId: first,
      });
      assert.equal((yield* engine.getThreadShell(first))?.linkedLinearIssue?.id, issue.id);
      yield* Effect.flip(
        engine.dispatch({
          ...input,
          commandId: CommandId.make("reject-conflict"),
          threadId: second,
        }),
      );
      assert.equal((yield* engine.getThreadShell(first))?.settledOverride, null);
      assert.equal((yield* engine.getThreadShell(second))?.worktreePath, null);
      yield* Effect.flip(
        engine.dispatch({
          ...input,
          commandId: CommandId.make("reject-stale"),
          threadId: second,
          expectedIssueId: "changed",
          takeoverThreadIds: [first],
        }),
      );
      assert.equal((yield* engine.getThreadShell(first))?.settledOverride, null);
      yield* engine.dispatch({
        ...input,
        commandId: CommandId.make("takeover"),
        threadId: second,
        takeoverThreadIds: [first],
      });
      assert.equal((yield* engine.getThreadShell(first))?.settledOverride, "settled");
      assert.equal((yield* engine.getThreadShell(second))?.linkedLinearIssue?.id, issue.id);
      yield* engine.dispatch({
        type: "thread.metadata.update",
        commandId: CommandId.make("unlink"),
        threadId: second,
        linkedLinearIssue: null,
      });
      assert.equal((yield* engine.getThreadShell(second))?.linkedLinearIssue, null);
      assert.equal((yield* engine.getThreadShell(second))?.worktreePath, input.worktreePath);
    }).pipe(Effect.provide(layerTest)),
);
it.effect("persists a code-language edit as a V2 event and rejects stale or streaming edits", () =>
  Effect.gen(function* () {
    const engine = yield* Orchestrator.OrchestratorV2;
    const projection = yield* ProjectionStore.ProjectionStoreV2;
    const threadId = yield* create("markdown");
    const now = DateTime.makeUnsafe("2026-01-01T00:00:00Z");
    const messageId = MessageId.make("answer");
    const item = {
      id: TurnItemId.make("answer-item"),
      threadId,
      runId: null,
      nodeId: null,
      providerThreadId: null,
      providerTurnId: null,
      nativeItemRef: null,
      parentItemId: null,
      ordinal: 1,
      status: "completed" as const,
      title: null,
      startedAt: now,
      completedAt: now,
      updatedAt: now,
      type: "assistant_message" as const,
      messageId,
      text: "```text\ngraph TD; A-->B\n```",
      streaming: false,
    };
    yield* projection.apply({
      id: EventId.make("seed-answer"),
      threadId,
      type: "turn-item.updated",
      occurredAt: now,
      payload: item,
    });
    const command = {
      type: "thread.message.code-language.set" as const,
      threadId,
      messageId,
      expectedUpdatedAt: DateTime.formatIso(now),
      blockStart: 0,
      expectedLanguage: "text",
      language: "mermaid",
    };
    const result = yield* engine.dispatch({ ...command, commandId: CommandId.make("language") });
    assert.isTrue(result.storedEvents.some((event) => event.event.type === "turn-item.updated"));
    const updated = yield* projection.getThreadProjection(threadId);
    const answer = updated.turnItems.find((entry) => entry.id === item.id);
    assert.ok(answer?.type === "assistant_message");
    assert.equal(answer.text, "```mermaid\ngraph TD; A-->B\n```");
    yield* Effect.flip(
      engine.dispatch({ ...command, commandId: CommandId.make("stale-language") }),
    );
    yield* projection.apply({
      id: EventId.make("stream-answer"),
      threadId,
      type: "turn-item.updated",
      occurredAt: now,
      payload: { ...item, streaming: true },
    });
    yield* Effect.flip(
      engine.dispatch({ ...command, commandId: CommandId.make("stream-language") }),
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "rejects new work while cleanup owns the thread and permits it after cleanup finishes",
  () =>
    Effect.gen(function* () {
      const engine = yield* Orchestrator.OrchestratorV2;
      const threadId = yield* create("closing-thread");
      beginThreadCleanup(threadId);
      const input = {
        type: "thread.linear-issue.select" as const,
        threadId,
        issue,
        baseRef: "main",
        worktreePath: "/tmp/linear-cleanup-gate",
        expectedWorktreePath: null,
        expectedIssueId: null,
        takeoverThreadIds: [],
      };
      yield* Effect.flip(
        engine.dispatch({ ...input, commandId: CommandId.make("cleanup-blocked") }),
      ).pipe(Effect.ensuring(Effect.sync(() => finishThreadCleanup(threadId))));
      assert.equal((yield* engine.getThreadShell(threadId))?.worktreePath, null);
      yield* engine.dispatch({ ...input, commandId: CommandId.make("cleanup-finished") });
      assert.equal((yield* engine.getThreadShell(threadId))?.worktreePath, input.worktreePath);
    }).pipe(Effect.provide(layerTest)),
);
