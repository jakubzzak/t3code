import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import {
  CommandId,
  InboxError,
  ProjectId,
  ProviderInstanceId,
  type InboxNotification,
  type InboxSourceItem,
} from "@t3tools/contracts";
import * as Inbox from "./InboxService.ts";
import * as Repository from "./InboxRepository.ts";
import * as Analysis from "./InboxAnalysis.ts";
import * as Research from "./InboxResearch.ts";
import * as Agent from "./InboxAgent.ts";
import * as Settings from "../serverSettings.ts";
import * as Sqlite from "../persistence/Sqlite.ts";

const projectId = ProjectId.make("research");
const item: InboxSourceItem = {
  id: "message",
  source: "slack",
  connectionId: "team",
  groupId: "thread",
  location: "#support",
  title: "Report",
  author: "Alex",
  content: "Please review the report",
  url: "https://example.com",
  occurredAt: "2026-10-22T10:00:00Z",
};
const fixture = (run: Research.InboxResearch["Service"]["research"]) =>
  Inbox.layer.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        Repository.layer.pipe(Layer.provide(Sqlite.layerMemory)),
        Settings.layerTest({
          projectSettingsOverrides: {
            [projectId]: {
              inboxEnabled: true,
              inboxSummaryEnabled: true,
              inboxPreResolution: true,
            },
          },
        }),
        Layer.succeed(Research.InboxResearch, { research: run }),
        Layer.succeed(Analysis.InboxAnalysis, {
          analyze: (n) =>
            Effect.succeed({
              description: "Review report",
              summary: n.items.at(-1)!.content,
              suggestions: [],
              precedentIds: [],
              modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
              generatedAt: n.updatedAt,
            }),
        }),
        Layer.succeed(Agent.InboxAgent, {
          start: () => Effect.void,
          stop: () => Effect.void,
          status: () =>
            Effect.succeed({ exists: false, running: false, settled: false, error: null }),
        }),
      ),
    ),
  );

it.effect(
  "delivers the summary before research, preserves triage during work, and updates preview and detail",
  () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const calls = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const service = yield* Inbox.InboxService;
        yield* service.ingest(projectId, [item]);
        yield* service.drainAnalysis;
        assert.equal(yield* Ref.get(calls), 0);
        const [visible] = yield* service.list({ projectId });
        assert.ok(visible?.analysis);
        assert.equal(visible.suggestionResearch?.status, "researching");
        yield* Deferred.await(entered);
        const read = yield* service.mutate({
          projectId,
          id: visible.id,
          expectedRevision: visible.revision,
          commandId: CommandId.make("read"),
          action: { type: "read", read: true },
        });
        assert.equal(read.notification.state.read, true);
        yield* Deferred.succeed(release, undefined);
        yield* service.drainResearch;
        const [preview] = yield* service.list({ projectId });
        assert.equal(preview?.suggestionResearch?.status, "ready");
        assert.deepEqual(preview?.analysis?.suggestions, []);
        const full = yield* service.get({ projectId, id: visible.id });
        assert.equal(full?.analysis?.summary, item.content);
        assert.deepEqual(full?.analysis?.suggestions, ["Check the report's final figures."]);
        assert.equal(full?.analysis?.replyDraft, "I checked the figures. They are correct.");
        assert.equal(full?.state.read, true);
        assert.equal(full?.revision, read.notification.revision);
        yield* service.drainResearch;
        assert.equal(yield* Ref.get(calls), 1);
      }).pipe(
        Effect.provide(
          fixture(() =>
            Ref.update(calls, (n) => n + 1).pipe(
              Effect.andThen(Deferred.succeed(entered, undefined)),
              Effect.andThen(Deferred.await(release)),
              Effect.as({
                suggestions: ["Check the report's final figures."],
                replyDraft: "I checked the figures. They are correct.",
              }),
            ),
          ),
        ),
      );
    }).pipe(Effect.scoped),
);

it.effect("records checked-empty explicitly and does not rerun it on later display", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0);
    yield* Effect.gen(function* () {
      const service = yield* Inbox.InboxService;
      yield* service.ingest(projectId, [item]);
      yield* service.drainAnalysis;
      const [first] = yield* service.list({ projectId });
      yield* service.drainResearch;
      const n = yield* service.get({ projectId, id: first!.id });
      assert.equal(n?.suggestionResearch?.status, "empty");
      assert.equal(n?.analysis?.summary, item.content);
      yield* service.list({ projectId });
      yield* service.drainResearch;
      assert.equal(yield* Ref.get(calls), 1);
    }).pipe(
      Effect.provide(
        fixture(() => Ref.update(calls, (n) => n + 1).pipe(Effect.as({ suggestions: [] }))),
      ),
    );
  }).pipe(Effect.scoped),
);

it.effect(
  "retries three times with increasing delays, then redo retries only the suggestion and is idempotent",
  () =>
    Effect.gen(function* () {
      const calls = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const service = yield* Inbox.InboxService;
        yield* service.ingest(projectId, [item]);
        yield* service.drainAnalysis;
        const [first] = yield* service.list({ projectId });
        yield* service.drainResearch;
        assert.equal(yield* Ref.get(calls), 1);
        yield* TestClock.adjust("4 seconds");
        yield* service.drainResearch;
        assert.equal(yield* Ref.get(calls), 1);
        yield* TestClock.adjust("1 second");
        yield* service.drainResearch;
        assert.equal(yield* Ref.get(calls), 2);
        yield* TestClock.adjust("10 seconds");
        yield* service.drainResearch;
        const n = yield* service.get({ projectId, id: first!.id });
        assert.equal(n?.suggestionResearch?.status, "unavailable");
        assert.equal(n?.suggestionResearch?.attempts, 3);
        assert.equal(n?.analysis?.summary, item.content);
        assert.equal(n?.processingError, null);
        const input = {
          projectId,
          id: n!.id,
          expectedRevision: n!.revision,
          commandId: CommandId.make("redo"),
          action: { type: "retry-suggestion" as const },
        };
        const retry = yield* service.mutate(input);
        assert.equal(retry.undoCommandId, null);
        yield* service.mutate(input);
        yield* service.drainResearch;
        const ready = yield* service.get({ projectId, id: first!.id });
        assert.equal(ready?.suggestionResearch?.status, "ready");
        assert.equal(ready?.suggestionResearch?.version, 1);
        assert.equal(ready?.analysis?.generatedAt, n?.analysis?.generatedAt);
        assert.equal(yield* Ref.get(calls), 4);
      }).pipe(
        Effect.provide(
          fixture(() =>
            Ref.updateAndGet(calls, (n) => n + 1).pipe(
              Effect.flatMap((count) =>
                count < 4
                  ? Effect.fail(new InboxError({ detail: "offline" }))
                  : Effect.succeed({ suggestions: ["Review the figures."] }),
              ),
            ),
          ),
        ),
      );
    }).pipe(Effect.scoped),
);

it.effect(
  "rejects stale research after new activity and keeps summary generation independent",
  () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>(),
        release = yield* Deferred.make<void>();
      const calls = yield* Ref.make(0);
      yield* Effect.gen(function* () {
        const service = yield* Inbox.InboxService;
        yield* service.ingest(projectId, [item]);
        yield* service.drainAnalysis;
        const [first] = yield* service.list({ projectId });
        yield* Deferred.await(entered);
        yield* service.ingest(projectId, [
          {
            ...item,
            id: "new",
            content: "Review the updated report",
            occurredAt: "2026-10-22T11:00:00Z",
          },
        ]);
        yield* service.drainAnalysis;
        yield* Deferred.succeed(release, undefined);
        yield* service.drainResearch;
        const n = yield* service.get({ projectId, id: first!.id });
        assert.equal(n?.analysis?.summary, "Review the updated report");
        assert.deepEqual(n?.analysis?.suggestions, []);
        yield* service.drainResearch;
        assert.deepEqual(
          (yield* service.get({ projectId, id: first!.id }))?.analysis?.suggestions,
          ["New suggestion"],
        );
      }).pipe(
        Effect.provide(
          fixture(() =>
            Ref.updateAndGet(calls, (n) => n + 1).pipe(
              Effect.flatMap((count) =>
                count === 1
                  ? Deferred.succeed(entered, undefined).pipe(
                      Effect.andThen(Deferred.await(release)),
                      Effect.as({ suggestions: ["Stale suggestion"] }),
                    )
                  : Effect.succeed({ suggestions: ["New suggestion"] }),
              ),
            ),
          ),
        ),
      );
    }).pipe(Effect.scoped),
);

it.effect("resumes a persisted research lease without resetting its attempt budget", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0);
    yield* Effect.gen(function* () {
      const service = yield* Inbox.InboxService,
        repository = yield* Repository.InboxRepository;
      yield* service.ingest(projectId, [item]);
      yield* service.drainAnalysis;
      const [n] = yield* repository.list(projectId);
      assert.ok(n?.analysis);
      yield* repository.put({
        ...n,
        suggestionResearch: {
          status: "researching",
          attempts: 2,
          version: 0,
          retryAt: "1970-01-01T00:05:00.000Z",
        },
      } satisfies InboxNotification);
      yield* service.drainResearch;
      assert.equal(yield* Ref.get(calls), 0);
      yield* TestClock.adjust("5 minutes");
      yield* service.drainResearch;
      const recovered = yield* repository.get(projectId, n.id);
      assert.equal(recovered?.suggestionResearch?.attempts, 3);
      assert.equal(recovered?.suggestionResearch?.status, "empty");
    }).pipe(
      Effect.provide(
        fixture(() => Ref.update(calls, (n) => n + 1).pipe(Effect.as({ suggestions: [] }))),
      ),
    );
  }).pipe(Effect.scoped),
);
