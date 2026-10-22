import { ingestInboxItem } from "./inboxState.ts";
import * as Analysis from "./InboxAnalysis.ts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import {
  CommandId,
  InboxError,
  ProjectId,
  ProviderInstanceId,
  type InboxSourceItem,
  type InboxNotification,
} from "@t3tools/contracts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Settings from "../serverSettings.ts";
import * as Inbox from "./InboxService.ts";
import * as Repository from "./InboxRepository.ts";
import * as Agent from "./InboxAgent.ts";
const projectId = ProjectId.make("project-a");
const item: InboxSourceItem = {
  id: "n1",
  source: "linear",
  connectionId: "team",
  groupId: "issue",
  location: "ENG-1",
  title: "Release",
  author: "Alex",
  content: "Please check",
  url: "https://linear.app/team/issue/ENG-1",
  occurredAt: "2026-10-22T10:00:00Z",
};
const dependencies = Layer.mergeAll(
  Repository.layer.pipe(Layer.provide(Sqlite.layerMemory)),
  Settings.layerTest({
    projectSettingsOverrides: {
      [projectId]: { inboxEnabled: true, inboxSummaryEnabled: false, inboxAgentEnabled: true },
    },
  }),
);
const scenario = Effect.gen(function* () {
  const analysisCalls = yield* Ref.make(0);
  const analyzedHistory = yield* Ref.make<ReadonlyArray<InboxNotification>>([]);
  const starts = yield* Ref.make(0);
  const stops = yield* Ref.make(0);
  const running = yield* Ref.make(false);
  const settled = yield* Ref.make(false);
  const fail = yield* Ref.make(false);
  const providerError = yield* Ref.make<string | null>(null);
  const agent = Agent.InboxAgent.of({
    start: (_, run) =>
      Effect.gen(function* () {
        if (yield* Ref.get(fail)) return yield* new InboxError({ detail: "Provider offline" });
        if (run) {
          yield* Ref.update(starts, (n) => n + 1);
          yield* Ref.set(running, true);
        }
      }),
    stop: () => Ref.update(stops, (n) => n + 1).pipe(Effect.andThen(Ref.set(running, false))),
    status: () =>
      Effect.all({
        running: Ref.get(running),
        settled: Ref.get(settled),
        error: Ref.get(providerError),
      }).pipe(Effect.map((state) => ({ ...state, exists: true }))),
  });
  return {
    analysisCalls,
    analyzedHistory,
    starts,
    stops,
    running,
    settled,
    fail,
    providerError,
    layer: Inbox.layer.pipe(
      Layer.provide(Layer.succeed(Agent.InboxAgent, agent)),
      Layer.provideMerge(dependencies),
      Layer.provide(
        Layer.succeed(Analysis.InboxAnalysis, {
          analyze: (_, history) =>
            Ref.update(analysisCalls, (n) => n + 1).pipe(
              Effect.andThen(Ref.set(analyzedHistory, history)),
              Effect.andThen(Effect.fail(new InboxError({ detail: "Model unavailable" }))),
            ),
        }),
      ),
    ),
  };
});
it.effect(
  "persists delegation once, opens the linked chat on repeats, and undo requests stop without removing work",
  () =>
    Effect.gen(function* () {
      const fixture = yield* scenario;
      yield* Effect.gen(function* () {
        const service = yield* Inbox.InboxService;
        yield* service.ingest(projectId, [item]);
        const [first] = yield* service.list({ projectId });
        assert.ok(first);
        const input = {
          projectId,
          id: first.id,
          commandId: CommandId.make("delegate"),
          expectedRevision: first.revision,
          action: { type: "delegate" as const, startAgent: true },
        };
        const delegated = yield* service.mutate(input);
        yield* service.drain;
        const repeated = yield* service.mutate(input);
        const reused = yield* Effect.result(
          service.mutate({ ...input, action: { type: "read", read: true } }),
        );
        assert.equal(reused._tag, "Failure");
        assert.equal(repeated.notification.state.threadId, delegated.notification.state.threadId);
        assert.equal(yield* Ref.get(fixture.starts), 1);
        const current = yield* service.get({ projectId, id: first.id });
        assert.ok(current);
        const undo = yield* service.mutate({
          ...input,
          commandId: CommandId.make("undo"),
          expectedRevision: current.revision,
          action: { type: "undo", commandId: input.commandId },
        });
        assert.equal(undo.notification.state.placement, "active");
        assert.equal(undo.notification.state.threadId, delegated.notification.state.threadId);
        assert.equal(undo.notification.agentStatus, "stop-requested");
        yield* service.drain;
        assert.equal(yield* Ref.get(fixture.stops), 1);
        yield* service.drain;
        assert.equal(yield* Ref.get(fixture.stops), 1);
        const [restored] = yield* service.list({ projectId });
        assert.ok(restored);
        assert.equal(restored.agentStatus, "stopped");
        const reopen = yield* service.mutate({
          ...input,
          commandId: CommandId.make("open"),
          expectedRevision: restored.revision,
        });
        assert.equal(reopen.openThread, true);
        assert.equal(reopen.undoCommandId, null);
        yield* service.drain;
        assert.equal(yield* Ref.get(fixture.starts), 1);
      }).pipe(Effect.provide(fixture.layer));
    }).pipe(Effect.scoped),
);
it.effect("Agent chat starts no turn; settling and reopening it update the notification", () =>
  Effect.gen(function* () {
    const fixture = yield* scenario;
    yield* Effect.gen(function* () {
      const service = yield* Inbox.InboxService;
      yield* service.ingest(projectId, [item]);
      const [first] = yield* service.list({ projectId });
      assert.ok(first);
      yield* service.mutate({
        projectId,
        id: first.id,
        commandId: CommandId.make("chat"),
        expectedRevision: first.revision,
        action: { type: "delegate", startAgent: false },
      });
      yield* service.drain;
      assert.equal(yield* Ref.get(fixture.starts), 0);
      yield* Ref.set(fixture.settled, true);
      assert.equal((yield* service.list({ projectId }))[0]?.state.placement, "resolved");
      yield* Ref.set(fixture.settled, false);
      assert.equal((yield* service.list({ projectId }))[0]?.state.placement, "delegated");
      assert.equal(
        (yield* Effect.result(service.list({ projectId: ProjectId.make("b") })))._tag,
        "Failure",
      );
    }).pipe(Effect.provide(fixture.layer));
  }).pipe(Effect.scoped),
);

it.effect("reports asynchronous provider failure and retries only on explicit request", () =>
  Effect.gen(function* () {
    const fixture = yield* scenario;
    yield* Effect.gen(function* () {
      const service = yield* Inbox.InboxService;
      yield* service.ingest(projectId, [item]);
      const first = (yield* service.list({ projectId }))[0]!;
      yield* service.mutate({
        projectId,
        id: first.id,
        commandId: CommandId.make("run"),
        expectedRevision: first.revision,
        action: { type: "delegate", startAgent: true },
      });
      yield* service.drain;
      yield* Ref.set(fixture.running, false);
      yield* Ref.set(fixture.providerError, "Provider could not start");
      const failed = (yield* service.list({ projectId }))[0]!;
      assert.equal(failed.agentStatus, "failed");
      assert.equal(failed.agentError, "Provider could not start");
      yield* Ref.set(fixture.providerError, null);
      yield* service.mutate({
        projectId,
        id: first.id,
        commandId: CommandId.make("retry"),
        expectedRevision: failed.revision,
        action: { type: "retry" },
      });
      yield* service.drain;
      assert.equal(yield* Ref.get(fixture.starts), 2);
    }).pipe(Effect.provide(fixture.layer));
  }).pipe(Effect.scoped),
);

it.effect(
  "reprocessing clears a failed summary while preserving raw content and triage state",
  () =>
    Effect.gen(function* () {
      const fixture = yield* scenario;
      yield* Effect.gen(function* () {
        const repository = yield* Repository.InboxRepository;
        const service = yield* Inbox.InboxService;
        const settings = yield* Settings.ServerSettingsService;
        yield* settings.updateSettings({
          projectSettingsOverrides: {
            [projectId]: { inboxEnabled: true, inboxSummaryEnabled: true },
          },
        });
        const notification = {
          ...ingestInboxItem(projectId, item),
          processingError: "Model unavailable",
        };
        yield* repository.put(notification);
        const result = yield* service.mutate({
          projectId,
          id: notification.id,
          expectedRevision: notification.revision,
          commandId: CommandId.make("reprocess"),
          action: { type: "reprocess" },
        });
        assert.equal(result.notification.processingError, null);
        assert.deepEqual(result.notification.items, [item]);
        assert.deepEqual(result.notification.state, notification.state);
        assert.equal(result.undoCommandId, null);
      }).pipe(Effect.provide(fixture.layer), Effect.provide(dependencies));
    }).pipe(Effect.scoped),
);

it.effect("lists bounded AI summaries and keeps full source context and next steps in detail", () =>
  Effect.gen(function* () {
    const fixture = yield* scenario;
    yield* Effect.gen(function* () {
      const repository = yield* Repository.InboxRepository;
      const service = yield* Inbox.InboxService;
      const summary = "Review the reconnect fix after sleep. ".repeat(40);
      const notification = {
        ...ingestInboxItem(projectId, {
          ...item,
          content: "Original context. ".repeat(100),
          formattedContent: "Formatted context. ".repeat(1000),
        }),
        analysis: {
          description: "Old one-sentence description",
          summary,
          suggestions: ["Verify the reconnect flow."],
          precedentIds: [],
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
          generatedAt: item.occurredAt,
        },
      } satisfies InboxNotification;
      yield* repository.put(notification);
      const [preview] = yield* service.list({ projectId });
      assert.ok(preview);
      assert.ok(preview.analysis);
      assert.ok(preview.analysis.summary.startsWith("Review the reconnect fix after sleep."));
      assert.ok(preview.analysis.summary.length <= 601);
      assert.ok(preview.analysis.summary.endsWith("…"));
      assert.deepEqual(preview.analysis.suggestions, []);
      assert.ok(preview.items[0]!.content.length <= 320);
      assert.equal(preview.items[0]?.formattedContent, undefined);
      const detail = yield* service.get({ projectId, id: notification.id });
      assert.deepEqual(detail?.analysis, notification.analysis);
      assert.deepEqual(detail?.items, notification.items);
      yield* repository.put({
        ...notification,
        analysis: { ...notification.analysis, summary: "Review the reconnect fix." },
      });
      const [shortPreview] = yield* service.list({ projectId });
      assert.equal(shortPreview?.analysis?.summary, "Review the reconnect fix.");
    }).pipe(Effect.provide(fixture.layer), Effect.provide(dependencies));
  }).pipe(Effect.scoped),
);

it.effect(
  "pages retained notifications and searches beyond the first page within the project",
  () =>
    Effect.gen(function* () {
      const fixture = yield* scenario;
      yield* Effect.gen(function* () {
        const repository = yield* Repository.InboxRepository;
        const service = yield* Inbox.InboxService;
        for (let index = 0; index < 105; index++)
          yield* repository.put({
            ...ingestInboxItem(projectId, {
              ...item,
              id: String(index),
              groupId: String(index),
              content: index === 0 ? "Rare historical request" : "Other request",
              occurredAt: DateTime.formatIso(DateTime.makeUnsafe(1767225600000 + index * 1000)),
            }),
            processingError: "Fixture: skip AI",
          });
        const page = yield* service.list({ projectId });
        const next = yield* service.list({ projectId, offset: 100 });
        assert.equal(page.length, 100);
        assert.equal(next.length, 5);
        assert.equal(new Set([...page, ...next].map((entry) => entry.id)).size, 105);
        assert.equal((yield* service.list({ projectId, search: "Rare historical" })).length, 1);
      }).pipe(Effect.provide(fixture.layer), Effect.provide(dependencies));
    }).pipe(Effect.scoped),
);

it.effect("retrieves confirmed outcomes even when more than 500 active notifications exist", () =>
  Effect.gen(function* () {
    const fixture = yield* scenario;
    yield* Effect.gen(function* () {
      const repository = yield* Repository.InboxRepository;
      const service = yield* Inbox.InboxService;
      const settings = yield* Settings.ServerSettingsService;
      yield* settings.updateSettings({
        projectSettingsOverrides: {
          [projectId]: { inboxEnabled: true, inboxSummaryEnabled: true, inboxMemoryEnabled: true },
        },
      });
      const precedent = {
        ...ingestInboxItem(projectId, { ...item, id: "past", groupId: "past" }),
        confirmedOutcome: "Fixed by rotating the key",
        processingError: "Fixture: skip AI",
      };
      yield* repository.put({ ...precedent, state: { ...precedent.state, placement: "resolved" } });
      for (let index = 0; index < 501; index++)
        yield* repository.put({
          ...ingestInboxItem(projectId, { ...item, id: String(index), groupId: String(index) }),
          processingError: "Fixture: skip AI",
        });
      yield* repository.put(
        ingestInboxItem(projectId, { ...item, id: "current", groupId: "current" }),
      );
      yield* service.drainAnalysis;
      assert.ok(
        (yield* Ref.get(fixture.analyzedHistory)).some((entry) => entry.id === precedent.id),
      );
    }).pipe(Effect.provide(fixture.layer), Effect.provide(dependencies));
  }).pipe(Effect.scoped),
);

it.effect("does not pass notification history to processing while project memory is off", () =>
  Effect.gen(function* () {
    const fixture = yield* scenario;
    yield* Effect.gen(function* () {
      const repository = yield* Repository.InboxRepository;
      const service = yield* Inbox.InboxService;
      const settings = yield* Settings.ServerSettingsService;
      yield* settings.updateSettings({
        projectSettingsOverrides: {
          [projectId]: { inboxEnabled: true, inboxSummaryEnabled: true },
        },
      });
      yield* repository.put({
        ...ingestInboxItem(projectId, { ...item, id: "past", groupId: "past" }),
        confirmedOutcome: "The old issue was fixed by rotating the key.",
        processingError: "Fixture: skip AI",
      });
      yield* repository.put(ingestInboxItem(projectId, item));
      yield* service.drainAnalysis;
      assert.deepEqual(yield* Ref.get(fixture.analyzedHistory), []);
    }).pipe(Effect.provide(Layer.merge(fixture.layer, dependencies)));
  }).pipe(Effect.scoped),
);

it.effect("rechecks the caller after waiting for the mutation lock", () =>
  Effect.gen(function* () {
    const fixture = yield* scenario;
    yield* Effect.gen(function* () {
      const repository = yield* Repository.InboxRepository;
      const service = yield* Inbox.InboxService;
      const notification = {
        ...ingestInboxItem(projectId, item),
        processingError: "Fixture: skip AI",
      };
      yield* repository.put(notification);
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const allowed = yield* Ref.make(true);
      const first = yield* service
        .mutate(
          {
            projectId,
            id: notification.id,
            expectedRevision: 0,
            commandId: CommandId.make("first-held"),
            action: { type: "read", read: true },
          },
          Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release))),
        )
        .pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      const second = yield* service
        .mutate(
          {
            projectId,
            id: notification.id,
            expectedRevision: 1,
            commandId: CommandId.make("revoked"),
            action: { type: "resolve", resolved: true },
          },
          Ref.get(allowed).pipe(
            Effect.flatMap((value) => (value ? Effect.void : Effect.fail("permission revoked"))),
          ),
        )
        .pipe(Effect.result, Effect.forkChild);
      yield* Ref.set(allowed, false);
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(first);
      const result = yield* Fiber.join(second);
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure") assert.equal(result.failure, "permission revoked");
      assert.equal((yield* repository.get(projectId, notification.id))?.state.placement, "active");
    }).pipe(Effect.provide(fixture.layer), Effect.provide(dependencies));
  }).pipe(Effect.scoped),
);

it.effect(
  "gates summary processing and direct delegation while compose and existing links remain available",
  () =>
    Effect.gen(function* () {
      const fixture = yield* scenario;
      yield* Effect.gen(function* () {
        const service = yield* Inbox.InboxService;
        const repository = yield* Repository.InboxRepository;
        const settings = yield* Settings.ServerSettingsService;
        yield* settings.updateSettings({
          projectSettingsOverrides: {
            [projectId]: {
              inboxEnabled: true,
              inboxSummaryEnabled: false,
              inboxAgentEnabled: false,
            },
          },
        });
        const notification = ingestInboxItem(projectId, item);
        yield* repository.put(notification);
        yield* service.drainAnalysis;
        assert.equal(yield* Ref.get(fixture.analysisCalls), 0);
        const command = { projectId, id: notification.id, expectedRevision: notification.revision };
        const blocked = yield* service
          .mutate({
            ...command,
            commandId: CommandId.make("disabled-agent"),
            action: { type: "delegate", startAgent: true },
          })
          .pipe(Effect.result);
        assert.equal(blocked._tag, "Failure");
        assert.equal((yield* repository.get(projectId, notification.id))?.state.threadId, null);
        const reprocess = yield* service
          .mutate({
            ...command,
            commandId: CommandId.make("disabled-summary"),
            action: { type: "reprocess" },
          })
          .pipe(Effect.result);
        assert.equal(reprocess._tag, "Failure");
        const compose = yield* service.mutate({
          ...command,
          commandId: CommandId.make("compose-without-agent"),
          action: { type: "delegate", startAgent: false },
        });
        assert.equal(compose.openThread, true);
        yield* service.drain;
        assert.equal(yield* Ref.get(fixture.starts), 0);
        const linked = yield* repository.get(projectId, notification.id);
        assert.ok(linked?.state.threadId);
        const reopen = yield* service.mutate({
          ...command,
          expectedRevision: linked.revision,
          commandId: CommandId.make("reopen-disabled-agent"),
          action: { type: "delegate", startAgent: true },
        });
        assert.equal(reopen.openThread, true);
        assert.equal(yield* Ref.get(fixture.starts), 0);
        yield* settings.updateSettings({
          projectSettingsOverrides: {
            [projectId]: {
              inboxEnabled: true,
              inboxSummaryEnabled: true,
              inboxAgentEnabled: false,
            },
          },
        });
        yield* service.drainAnalysis;
        assert.equal(yield* Ref.get(fixture.analysisCalls), 1);
      }).pipe(Effect.provide(Layer.merge(fixture.layer, dependencies)));
    }).pipe(Effect.scoped),
);

it.effect(
  "repairs previously stored HTML on detail/list reads without reopening or marking it unread",
  () =>
    Effect.gen(function* () {
      const fixture = yield* scenario;
      yield* Effect.gen(function* () {
        const repository = yield* Repository.InboxRepository;
        const service = yield* Inbox.InboxService;
        const raw = ingestInboxItem(projectId, {
          ...item,
          source: "superhuman",
          content: "<p>Send the PHP security report by EOD.</p>",
        });
        const state = { ...raw.state, read: true, placement: "resolved" as const };
        yield* repository.put({ ...raw, state });
        const clean = yield* service.get({ projectId, id: raw.id });
        assert.ok(clean);
        assert.equal(clean.items[0]?.content, "Send the PHP security report by EOD.");
        assert.equal(clean.items[0]?.contentFormat, "text");
        assert.deepEqual(clean.state, state);
        assert.equal(clean.revision, raw.revision + 1);
        const persisted = yield* repository.get(projectId, raw.id);
        assert.equal(persisted?.items[0]?.content, clean.items[0]?.content);
        const again = yield* service.get({ projectId, id: raw.id });
        assert.equal(again?.analysisVersion, clean.analysisVersion);
        assert.equal(again?.revision, clean.revision);
        const listed = yield* service.list({ projectId });
        assert.equal(listed[0]?.items[0]?.content, clean.items[0]?.content);
        assert.deepEqual(listed[0]?.state, state);
        yield* service.ingest(projectId, [
          {
            contentFormat: "text",
            ...raw.items[0]!,
            content: "Send the PHP security report by EOD.",
          },
        ]);
        const refreshed = yield* service.get({ projectId, id: raw.id });
        assert.deepEqual(refreshed?.state, state);
        assert.equal(refreshed?.analysisVersion, clean.analysisVersion);
        assert.equal(refreshed?.revision, clean.revision);
      }).pipe(Effect.provide(fixture.layer));
    }),
);
