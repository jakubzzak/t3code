import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as TestClock from "effect/testing/TestClock";
import {
  InboxError,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type InboxSourceItem,
} from "@t3tools/contracts";
import * as Inbox from "./InboxService.ts";
import * as Repository from "./InboxRepository.ts";
import * as Analysis from "./InboxAnalysis.ts";
import * as Research from "./InboxResearch.ts";
import * as Agent from "./InboxAgent.ts";
import * as Settings from "../serverSettings.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import { readSuperhumanInbox } from "./connectors/superhuman.ts";
import { inboxContext } from "./notificationContext.ts";
import { ingestInboxItem } from "./inboxState.ts";
const projectId = ProjectId.make("delivery");
const item: InboxSourceItem = {
  id: "one",
  source: "slack",
  connectionId: "team",
  groupId: "thread",
  location: "#support",
  title: "Report request",
  author: "Alex",
  content: "Send the report today",
  url: "https://example.com",
  occurredAt: "2026-10-22T10:00:00Z",
};
const fixture = (succeedAt = 0, hang = false, blockFirst = false, summarizeContext = false) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<number[]>([]);
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const deps = Layer.mergeAll(
      Layer.succeed(Research.InboxResearch, {
        research: () => Effect.succeed({ suggestions: [] }),
      }),
      Repository.layer.pipe(Layer.provide(Sqlite.layerMemory)),
      Settings.layerTest({
        projectSettingsOverrides: {
          [projectId]: { inboxEnabled: true, inboxSummaryEnabled: true },
        },
      }),
      Layer.succeed(Agent.InboxAgent, {
        start: () => Effect.void,
        stop: () => Effect.void,
        status: () =>
          Effect.succeed({ exists: false, running: false, settled: false, error: null }),
      }),
      Layer.succeed(Analysis.InboxAnalysis, {
        analyze: (notification) =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const next = yield* Ref.updateAndGet(calls, (values) => [...values, now]);
            yield* Deferred.succeed(entered, undefined);
            if (hang) return yield* Effect.never;
            if (blockFirst && next.length === 1) yield* Deferred.await(release);
            if (next.length !== succeedAt)
              return yield* new InboxError({ detail: "Provider unavailable" });
            return {
              description: "Report",
              summary: summarizeContext
                ? inboxContext(notification).slice(0, 1000)
                : `${notification.items.at(-1)?.content}.`,
              suggestions: [],
              precedentIds: [],
              modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "fixture" },
              generatedAt: item.occurredAt,
            };
          }),
      }),
    );
    return { calls, entered, release, layer: Inbox.layer.pipe(Layer.provideMerge(deps)) };
  });
it.effect(
  "withholds processing notifications, retries after increasing delays, then exposes terminal failure once",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* Effect.gen(function* () {
        const service = yield* Inbox.InboxService;
        const repository = yield* Repository.InboxRepository;
        yield* service.ingest(projectId, [item]);
        yield* service.drainAnalysis;
        assert.deepEqual(yield* service.list({ projectId }), []);
        assert.equal((yield* Ref.get(f.calls)).length, 1);
        yield* TestClock.adjust("4 seconds");
        yield* service.drainAnalysis;
        assert.equal((yield* Ref.get(f.calls)).length, 1);
        yield* TestClock.adjust("1 second");
        yield* service.drainAnalysis;
        assert.equal((yield* Ref.get(f.calls)).length, 2);
        assert.deepEqual(yield* service.list({ projectId }), []);
        yield* TestClock.adjust("9 seconds");
        yield* service.drainAnalysis;
        assert.equal((yield* Ref.get(f.calls)).length, 2);
        yield* TestClock.adjust("1 second");
        yield* service.drainAnalysis;
        const [visible] = yield* service.list({ projectId });
        assert.equal(visible?.processingError, "AI summary not available");
        assert.equal(visible?.analysisAttempts, 3);
        assert.equal(visible?.analysisRetryAt, null);
        assert.deepEqual(yield* Ref.get(f.calls), [0, 5_000, 15_000]);
        yield* TestClock.adjust("1 minute");
        yield* service.drainAnalysis;
        assert.equal((yield* Ref.get(f.calls)).length, 3);
        assert.equal(
          (yield* repository.get(projectId, visible!.id))?.items[0]?.content,
          item.content,
        );
      }).pipe(Effect.provide(f.layer));
    }).pipe(Effect.scoped),
);
it.effect("delivers the successful retry immediately without exposing a pending row", () =>
  Effect.gen(function* () {
    const f = yield* fixture(2);
    yield* Effect.gen(function* () {
      const service = yield* Inbox.InboxService;
      yield* service.ingest(projectId, [item]);
      yield* service.drainAnalysis;
      assert.deepEqual(yield* service.list({ projectId }), []);
      yield* TestClock.adjust("5 seconds");
      yield* service.drainAnalysis;
      assert.equal(
        (yield* service.list({ projectId }))[0]?.analysis?.summary,
        "Send the report today.",
      );
      yield* TestClock.adjust("1 minute");
      yield* service.drainAnalysis;
      assert.equal((yield* Ref.get(f.calls)).length, 2);
    }).pipe(Effect.provide(f.layer));
  }).pipe(Effect.scoped),
);
it.effect(
  "filters unfinished rows before pagination so ready notifications are not hidden behind them",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* Effect.gen(function* () {
        const repository = yield* Repository.InboxRepository;
        const service = yield* Inbox.InboxService;
        const future = "2099-01-01T00:00:00Z";
        for (let index = 0; index < 105; index++)
          yield* repository.put({
            ...ingestInboxItem(projectId, { ...item, id: String(index), groupId: String(index) }),
            analysisRetryAt: future,
          });
        const ready = {
          ...ingestInboxItem(projectId, {
            ...item,
            id: "ready",
            groupId: "ready",
            occurredAt: "2026-10-21T00:00:00Z",
          }),
          processingError: "AI summary not available",
          analysisAttempts: 3,
        };
        yield* repository.put(ready);
        assert.deepEqual(
          (yield* service.list({ projectId })).map((notification) => notification.id),
          [ready.id],
        );
        const settings = yield* Settings.ServerSettingsService;
        yield* settings.updateSettings({
          projectSettingsOverrides: {
            [projectId]: { inboxEnabled: true, inboxSummaryEnabled: false },
          },
        });
        assert.equal((yield* service.list({ projectId })).length, 100);
        assert.equal((yield* service.list({ projectId, offset: 100 })).length, 6);
      }).pipe(Effect.provide(f.layer));
    }).pipe(Effect.scoped),
);
it.effect("resumes a persisted second failure without resetting the retry budget", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* Effect.gen(function* () {
      const repository = yield* Repository.InboxRepository;
      const service = yield* Inbox.InboxService;
      yield* repository.put({
        ...ingestInboxItem(projectId, item),
        analysisAttempts: 2,
        analysisRetryAt: "1970-01-01T00:00:10.000Z",
      });
      yield* service.drainAnalysis;
      assert.equal((yield* Ref.get(f.calls)).length, 0);
      yield* TestClock.adjust("10 seconds");
      yield* service.drainAnalysis;
      assert.equal(
        (yield* service.list({ projectId }))[0]?.processingError,
        "AI summary not available",
      );
      assert.equal((yield* Ref.get(f.calls)).length, 1);
    }).pipe(Effect.provide(f.layer));
  }).pipe(Effect.scoped),
);

it.effect("bounds hung model calls and exposes failure after three timed-out attempts", () =>
  Effect.gen(function* () {
    const f = yield* fixture(0, true);
    yield* Effect.gen(function* () {
      const service = yield* Inbox.InboxService;
      yield* service.ingest(projectId, [item]);
      yield* Deferred.await(f.entered);
      for (const delay of [0, 5_000, 10_000]) {
        if (delay) yield* TestClock.adjust(delay);
        const draining = yield* service.drainAnalysis.pipe(Effect.forkChild);
        yield* TestClock.adjust("1 minute");
        yield* Fiber.join(draining);
      }
      assert.equal(
        (yield* service.list({ projectId }))[0]?.processingError,
        "AI summary not available",
      );
      assert.equal((yield* Ref.get(f.calls)).length, 3);
    }).pipe(Effect.provide(f.layer));
  }).pipe(Effect.scoped),
);
it.effect("discards stale work when new message content arrives and starts a fresh budget", () =>
  Effect.gen(function* () {
    const f = yield* fixture(2, false, true);
    yield* Effect.gen(function* () {
      const service = yield* Inbox.InboxService;
      yield* service.ingest(projectId, [item]);
      yield* Deferred.await(f.entered);
      yield* service.ingest(projectId, [
        {
          ...item,
          id: "two",
          content: "Review the updated report",
          occurredAt: "2026-10-22T10:01:00Z",
        },
      ]);
      yield* Deferred.succeed(f.release, undefined);
      yield* service.drainAnalysis;
      const [visible] = yield* service.list({ projectId });
      assert.equal(visible?.analysis?.summary, "Review the updated report.");
      assert.equal(visible?.analysisAttempts, 1);
      yield* TestClock.adjust("20 seconds");
      yield* service.drainAnalysis;
      assert.equal((yield* Ref.get(f.calls)).length, 2);
    }).pipe(Effect.provide(f.layer));
  }).pipe(Effect.scoped),
);
it.effect(
  "does not issue a fourth model call after a restart during the third reserved attempt",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* Effect.gen(function* () {
        const repository = yield* Repository.InboxRepository;
        const service = yield* Inbox.InboxService;
        yield* repository.put({
          ...ingestInboxItem(projectId, item),
          analysisAttempts: 3,
          analysisRetryAt: "1970-01-01T00:00:02.000Z",
        });
        yield* TestClock.adjust("2 seconds");
        yield* service.drainAnalysis;
        assert.equal(
          (yield* service.list({ projectId }))[0]?.processingError,
          "AI summary not available",
        );
        assert.equal((yield* Ref.get(f.calls)).length, 0);
      }).pipe(Effect.provide(f.layer));
    }).pipe(Effect.scoped),
);

it.effect.each([5000, 33000])(
  "preserves the latest mail reply through persistence and summary context after %i earlier characters",
  (earlierLength) =>
    Effect.gen(function* () {
      const f = yield* fixture(1, false, false, true);
      yield* Effect.gen(function* () {
        const service = yield* Inbox.InboxService;
        const items = yield* Effect.promise(() =>
          readSuperhumanInbox(
            async (name) => {
              if (name === "list_accounts")
                return { accounts: [{ accountEmail: "me@example.com", isPrimary: true }] };
              const thread = {
                thread_id: "long-mail",
                subject: "Review",
                snippet: "Latest reply",
                last_message_at: "2026-10-22T12:00:00Z",
                last_message_id: "new",
                labels: [],
                splits: ["Important"],
              };
              if (name === "list_threads") return { threads: [thread] };
              return {
                ...thread,
                messages: [
                  {
                    message_id: "old",
                    from: "alex@example.com",
                    sent_at: "2026-10-22T10:00:00Z",
                    body: "A".repeat(earlierLength),
                    snippet: "Old context",
                  },
                  {
                    message_id: "new",
                    from: "me@example.com",
                    sent_at: "2026-10-22T12:00:00Z",
                    body: "LATEST: Friday is confirmed.",
                    snippet: "Latest reply",
                  },
                ],
              };
            },
            ["me@example.com"],
            ["split:Important"],
            "2026-10-22T00:00:00Z",
          ),
        );
        yield* service.ingest(projectId, items);
        yield* service.drainAnalysis;
        const [saved] = yield* service.list({ projectId });
        assert.isDefined(saved);
        assert.include(saved!.items[0]!.content, "LATEST: Friday is confirmed.");
        assert.include(inboxContext(saved!), "LATEST: Friday is confirmed.");
        assert.include(saved!.analysis!.summary, "LATEST: Friday is confirmed.");
        assert.isAtMost(saved!.items[0]!.content.length, 32000);
      }).pipe(Effect.provide(f.layer));
    }),
);

it.effect(
  "immediately filters retained self activity independently without mutating summaries or placement",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture(1);
      yield* Effect.gen(function* () {
        const repository = yield* Repository.InboxRepository;
        const service = yield* Inbox.InboxService;
        const settings = yield* Settings.ServerSettingsService;
        for (const [id, isSelf, kind] of [
          ["own-update", true, "update"],
          ["own-reply", true, "reply"],
          ["tars", false, "reply"],
          ["security", false, "reply"],
        ] as const) {
          yield* repository.put({
            ...ingestInboxItem(projectId, {
              ...item,
              id,
              groupId: id,
              replyActivity: [{ id, occurredAt: item.occurredAt, isSelf, kind }],
            }),
            processingError: "AI summary not available",
            analysisAttempts: 3,
          });
        }
        const original = yield* repository.get(
          projectId,
          (yield* service.list({ projectId }))[0]!.id,
        );
        assert.equal((yield* service.list({ projectId })).length, 4);
        yield* settings.updateSettings({ inboxShowSelfReplies: false });
        assert.deepEqual((yield* service.list({ projectId })).map((n) => n.groupId).sort(), [
          "own-update",
          "security",
          "tars",
        ]);
        yield* settings.updateSettings({ inboxShowSelfUpdates: false });
        assert.deepEqual((yield* service.list({ projectId })).map((n) => n.groupId).sort(), [
          "security",
          "tars",
        ]);
        assert.deepEqual(yield* service.list({ projectId, search: "own" }), []);
        yield* settings.updateSettings({ inboxShowSelfReplies: true });
        assert.deepEqual((yield* service.list({ projectId })).map((n) => n.groupId).sort(), [
          "own-reply",
          "security",
          "tars",
        ]);
        yield* settings.updateSettings({ inboxShowSelfUpdates: true });
        assert.equal((yield* service.list({ projectId })).length, 4);
        assert.deepEqual(yield* repository.get(projectId, original!.id), original);
      }).pipe(Effect.provide(f.layer));
    }).pipe(Effect.scoped),
);

it.effect(
  "filters self replies before pagination and keeps hidden notifications in summary processing",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture(1);
      yield* Effect.gen(function* () {
        const repository = yield* Repository.InboxRepository;
        const service = yield* Inbox.InboxService;
        const settings = yield* Settings.ServerSettingsService;
        yield* settings.updateSettings({ inboxShowSelfReplies: false });
        for (let index = 0; index < 105; index++) {
          yield* repository.put({
            ...ingestInboxItem(projectId, {
              ...item,
              id: String(index),
              groupId: String(index),
              replyActivity: [{ id: String(index), occurredAt: item.occurredAt, isSelf: true }],
            }),
            processingError: "AI summary not available",
          });
        }
        const ready = ingestInboxItem(projectId, {
          ...item,
          id: "incoming",
          groupId: "incoming",
          occurredAt: "2026-10-21T10:00:00Z",
        });
        yield* repository.put({ ...ready, processingError: "AI summary not available" });
        assert.deepEqual(
          (yield* service.list({ projectId, limit: 1 })).map((n) => n.id),
          [ready.id],
        );
        const hidden = ingestInboxItem(projectId, {
          ...item,
          id: "summarize-hidden",
          groupId: "summarize-hidden",
          replyActivity: [{ id: "self", occurredAt: item.occurredAt, isSelf: true }],
        });
        yield* repository.put(hidden);
        yield* service.drainAnalysis;
        assert.equal(
          (yield* repository.get(projectId, hidden.id))?.analysis?.summary,
          "Send the report today.",
        );
        assert.equal((yield* Ref.get(f.calls)).length, 1);
        yield* settings.updateSettings({ inboxShowSelfReplies: true });
        assert.equal((yield* service.list({ projectId, search: "report" })).length, 100);
        assert.equal((yield* Ref.get(f.calls)).length, 1);
      }).pipe(Effect.provide(f.layer));
    }).pipe(Effect.scoped),
);

it.effect.each(["slack", "linear", "superhuman"] as const)(
  "%s: external self replies hide settled items and later incoming replies restore the same item",
  (source) =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* Effect.gen(function* () {
        const repository = yield* Repository.InboxRepository;
        const service = yield* Inbox.InboxService;
        const settings = yield* Settings.ServerSettingsService;
        yield* settings.updateSettings({
          inboxShowSelfReplies: false,
          projectSettingsOverrides: {
            [projectId]: { inboxEnabled: true, inboxSummaryEnabled: false },
          },
        });
        const initial = ingestInboxItem(projectId, {
          ...item,
          source,
          replyActivity: [{ id: "root", occurredAt: item.occurredAt, isSelf: false }],
        });
        yield* repository.put({ ...initial, state: { ...initial.state, placement: "resolved" } });
        const selfReply = {
          ...item,
          source,
          id: "own",
          occurredAt: "2026-10-22T11:00:00Z",
          replyActivity: [{ id: "own", occurredAt: "2026-10-22T11:00:00Z", isSelf: true }],
        };
        yield* service.ingest(projectId, [selfReply]);
        assert.deepEqual(yield* service.list({ projectId }), []);
        assert.equal(
          (yield* service.get({ projectId, id: initial.id }))?.state.placement,
          "resolved",
        );
        yield* settings.updateSettings({ inboxShowSelfReplies: true });
        assert.equal((yield* service.list({ projectId }))[0]?.state.placement, "resolved");
        yield* settings.updateSettings({ inboxShowSelfReplies: false });
        yield* service.ingest(projectId, [
          {
            ...item,
            source,
            id: "incoming",
            occurredAt: "2026-10-22T12:00:00Z",
            replyActivity: [{ id: "incoming", occurredAt: "2026-10-22T12:00:00Z", isSelf: false }],
          },
        ]);
        const [resurfaced] = yield* service.list({ projectId });
        assert.equal(resurfaced?.id, initial.id);
        assert.equal(resurfaced?.state.placement, "active");
        yield* service.ingest(projectId, [selfReply]);
        assert.equal((yield* service.list({ projectId }))[0]?.replyCursor?.id, "incoming");
      }).pipe(Effect.provide(f.layer));
    }).pipe(Effect.scoped),
);

it.effect("applies visibility globally while retaining linked-chat detail access", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* Effect.gen(function* () {
      const repository = yield* Repository.InboxRepository;
      const service = yield* Inbox.InboxService;
      const settings = yield* Settings.ServerSettingsService;
      const second = ProjectId.make("second");
      yield* settings.updateSettings({
        inboxShowSelfReplies: false,
        projectSettingsOverrides: {
          [projectId]: { inboxEnabled: true, inboxSummaryEnabled: false },
          [second]: { inboxEnabled: true, inboxSummaryEnabled: false },
        },
      });
      const threadId = ThreadId.make("linked");
      for (const project of [projectId, second]) {
        const notification = ingestInboxItem(project, {
          ...item,
          replyActivity: [{ id: "own", occurredAt: item.occurredAt, isSelf: true }],
        });
        yield* repository.put({ ...notification, state: { ...notification.state, threadId } });
        assert.deepEqual(yield* service.list({ projectId: project }), []);
        assert.equal(
          (yield* service.list({ projectId: project, threadId }))[0]?.id,
          notification.id,
        );
      }
      yield* settings.updateSettings({ inboxShowSelfReplies: true });
      for (const project of [projectId, second])
        assert.equal((yield* service.list({ projectId: project })).length, 1);
    }).pipe(Effect.provide(f.layer));
  }).pipe(Effect.scoped),
);
