import { assert, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { CommandId, ProjectId, type InboxSourceItem } from "@t3tools/contracts";
import type { InboxAnalysisInput } from "@t3tools/provider-core/server/textGeneration";
import * as Projects from "../project/ProjectService.ts";
import * as Generation from "../textGeneration/TextGeneration.ts";
import * as Settings from "../serverSettings.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
import * as Inbox from "./InboxService.ts";
import * as Repository from "./InboxRepository.ts";
import * as Analysis from "./InboxAnalysis.ts";
import * as Research from "./InboxResearch.ts";
import * as Agent from "./InboxAgent.ts";
import { ingestInboxItem, inboxIdentity } from "./inboxState.ts";

const projectId = ProjectId.make("relevance");
const otherProject = ProjectId.make("other");
const message = (
  id: string,
  text = "Thanks, got it.",
  time = "2026-11-03T12:00:00Z",
  groupId = id,
): InboxSourceItem => ({
  id,
  source: "slack",
  connectionId: "team",
  groupId,
  title: "Message",
  author: "Alex",
  content: text,
  location: "DM",
  url: "https://example.test/message",
  occurredAt: time,
});
const fixture = (blockFirst = false, missingConfidence = false) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make<InboxAnalysisInput[]>([]);
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const base = Layer.mergeAll(
      Repository.layer.pipe(Layer.provide(Sqlite.layerMemory)),
      Settings.layerTest({
        projectSettingsOverrides: {
          [projectId]: { inboxEnabled: true, inboxSummaryEnabled: true, inboxMemoryEnabled: false },
          [otherProject]: { inboxEnabled: true, inboxSummaryEnabled: true },
        },
      }),
      Layer.mock(Projects.ProjectService)({
        getShell: (id) =>
          Effect.succeedSome({
            id,
            title: "Fixture",
            workspaceRoot: "/fixture",
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-11-03T00:00:00Z",
            updatedAt: "2026-11-03T00:00:00Z",
          }),
      }),
      Layer.mock(Generation.TextGeneration)({
        generateInboxAnalysis: (input) =>
          Effect.gen(function* () {
            const all = yield* Ref.updateAndGet(calls, (calls) => [...calls, input]);
            yield* Deferred.succeed(entered, undefined);
            if (blockFirst && all.length === 1) yield* Deferred.await(release);
            return {
              description: "Summary",
              summary: input.context.includes("urgent") ? "Urgent request" : "Acknowledgement",
              suggestions: [],
              precedentIds: [],
              ...(!missingConfidence
                ? { irrelevanceConfidence: input.context.includes("urgent") ? 3 : 99 }
                : {}),
            };
          }),
      }),
      Layer.succeed(Research.InboxResearch, {
        research: () => Effect.succeed({ suggestions: [] }),
      }),
      Layer.succeed(Agent.InboxAgent, {
        start: () => Effect.void,
        stop: () => Effect.void,
        status: () =>
          Effect.succeed({ exists: false, running: false, settled: false, error: null }),
      }),
    );
    const analysis = Analysis.layer.pipe(Layer.provideMerge(base));
    return { calls, entered, release, layer: Inbox.layer.pipe(Layer.provideMerge(analysis)) };
  });

it.effect(
  "classifies new intake with its summary, preserves legacy decisions and snapshots thresholds before pagination",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* Effect.gen(function* () {
        const service = yield* Inbox.InboxService;
        const repository = yield* Repository.InboxRepository;
        const settings = yield* Settings.ServerSettingsService;
        const legacy = ingestInboxItem(projectId, message("legacy"));
        yield* repository.put(legacy);
        yield* service.drainAnalysis;
        assert.equal((yield* Ref.get(f.calls))[0]?.classifyRelevance, false);
        assert.equal((yield* service.get({ projectId, id: legacy.id }))?.relevance, undefined);
        const first = message("fresh");
        yield* service.ingest(projectId, [first]);
        yield* service.drainAnalysis;
        const fresh = (yield* service.get({ projectId, id: inboxIdentity(projectId, first) }))!;
        assert.deepEqual(fresh.relevance, {
          version: 0,
          threshold: 98,
          status: "complete",
          confidence: 99,
          irrelevant: true,
        });
        assert.deepEqual(
          (yield* service.list({ projectId, limit: 1 })).map((n) => n.id),
          [legacy.id],
        );
        assert.deepEqual(
          (yield* service.list({ projectId, visibility: "filtered" })).map((n) => n.id),
          [fresh.id],
        );
        yield* settings.updateSettings({ inboxIrrelevanceThreshold: 100 });
        assert.equal((yield* service.list({ projectId, visibility: "filtered" }))[0]?.id, fresh.id);
        const later = message("later", "Thanks", "2026-11-03T13:00:00Z");
        yield* service.ingest(projectId, [later]);
        yield* service.drainAnalysis;
        const after = (yield* service.get({ projectId, id: inboxIdentity(projectId, later) }))!;
        assert.equal(after.relevance?.threshold, 100);
        assert.equal(after.relevance?.irrelevant, false);
        yield* service.mutate({
          projectId,
          id: fresh.id,
          commandId: CommandId.make("reprocess"),
          expectedRevision: fresh.revision,
          action: { type: "reprocess" },
        });
        yield* service.drainAnalysis;
        assert.equal((yield* Ref.get(f.calls)).at(-1)?.classifyRelevance, false);
        assert.deepEqual(
          (yield* service.get({ projectId, id: fresh.id }))?.relevance,
          fresh.relevance,
        );
      }).pipe(Effect.provide(f.layer));
    }).pipe(Effect.scoped),
);

it.effect(
  "never backfills pre-adoption or summary-disabled intake and fails open for absent confidence",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture(false, true);
      yield* Effect.gen(function* () {
        const service = yield* Inbox.InboxService;
        const settings = yield* Settings.ServerSettingsService;
        const historical = message("historical", "Thanks", "1969-12-31T23:59:59Z");
        yield* service.ingest(projectId, [historical]);
        yield* service.drainAnalysis;
        assert.equal((yield* Ref.get(f.calls))[0]?.classifyRelevance, false);
        yield* settings.updateSettings({
          projectSettingsOverrides: {
            [projectId]: { inboxEnabled: true, inboxSummaryEnabled: false },
          },
        });
        const disabled = message("disabled");
        yield* service.ingest(projectId, [disabled]);
        yield* settings.updateSettings({
          projectSettingsOverrides: {
            [projectId]: { inboxEnabled: true, inboxSummaryEnabled: true },
          },
        });
        yield* service.drainAnalysis;
        assert.equal((yield* Ref.get(f.calls)).at(-1)?.classifyRelevance, false);
        const fresh = message("fresh");
        yield* service.ingest(projectId, [fresh]);
        yield* service.drainAnalysis;
        assert.equal(
          (yield* service.get({ projectId, id: inboxIdentity(projectId, fresh) }))?.relevance
            ?.status,
          "unavailable",
        );
        assert.equal((yield* service.list({ projectId })).length, 3);
      }).pipe(Effect.provide(f.layer));
    }).pipe(Effect.scoped),
);

it.effect(
  "manual feedback is immutable, scoped, undoable and independent of outcome memory and resolution",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* Effect.gen(function* () {
        const service = yield* Inbox.InboxService;
        const repository = yield* Repository.InboxRepository;
        const legacy = ingestInboxItem(projectId, message("legacy", "Yes, thank you."));
        yield* repository.put(legacy);
        yield* service.drainAnalysis;
        const current = (yield* service.get({ projectId, id: legacy.id }))!;
        const input = {
          projectId,
          id: current.id,
          commandId: CommandId.make("mark"),
          expectedRevision: current.revision,
          action: { type: "irrelevant" as const, irrelevant: true },
        };
        const marked = yield* service.mutate(input);
        yield* service.mutate(input);
        assert.equal(marked.notification.state.placement, "active");
        assert.equal((yield* service.list({ projectId })).length, 0);
        const references = yield* service.references({ projectId });
        assert.equal(references.length, 1);
        assert.include(references[0]!.content, "Yes, thank you.");
        assert.deepEqual(yield* service.references({ projectId: otherProject }), []);
        const kept = yield* service.mutate({
          projectId,
          id: current.id,
          commandId: CommandId.make("keep"),
          expectedRevision: marked.notification.revision,
          action: { type: "irrelevant", irrelevant: false },
        });
        assert.equal((yield* service.references({ projectId }))[0]?.irrelevant, false);
        assert.equal((yield* service.references({ projectId })).length, 1);
        const undone = yield* service.mutate({
          projectId,
          id: current.id,
          commandId: CommandId.make("undo-keep"),
          expectedRevision: kept.notification.revision,
          action: { type: "undo", commandId: CommandId.make("keep") },
        });
        assert.equal((yield* service.references({ projectId }))[0]?.irrelevant, true);
        yield* service.mutate({
          projectId,
          id: current.id,
          commandId: CommandId.make("undo-mark"),
          expectedRevision: undone.notification.revision,
          action: { type: "undo", commandId: CommandId.make("mark") },
        });
        assert.deepEqual(yield* service.references({ projectId }), []);
        assert.equal((yield* service.list({ projectId })).length, 1);
        const again = (yield* service.get({ projectId, id: current.id }))!;
        yield* service.mutate({
          ...input,
          commandId: CommandId.make("remark"),
          expectedRevision: again.revision,
        });
        const fresh = message(
          "later",
          "urgent: can you send the report?",
          "2026-11-03T13:00:00Z",
          "legacy",
        );
        yield* service.ingest(projectId, [fresh]);
        yield* service.drainAnalysis;
        const next = (yield* service.get({ projectId, id: current.id }))!;
        assert.equal(next.state.irrelevant, undefined);
        assert.equal(next.state.placement, "active");
        assert.equal(next.relevance?.irrelevant, false);
        assert.include((yield* service.references({ projectId }))[0]!.content, "Yes, thank you.");
        const lastInput = (yield* Ref.get(f.calls)).at(-1)!;
        assert.equal(lastInput.precedents.length, 0);
        assert.include(lastInput.relevanceReferences![0]!.content, "Yes, thank you.");
        assert.equal(
          (yield* Effect.result(
            service.mutate({
              projectId,
              id: next.id,
              commandId: CommandId.make("late-undo"),
              expectedRevision: next.revision,
              action: { type: "undo", commandId: CommandId.make("remark") },
            }),
          ))._tag,
          "Failure",
        );
      }).pipe(Effect.provide(f.layer));
    }).pipe(Effect.scoped),
);

it.effect(
  "a newer incoming message wins over an in-flight assessment while retaining the marked example",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture(true);
      yield* Effect.gen(function* () {
        const service = yield* Inbox.InboxService;
        const first = message("first", "Thanks");
        yield* service.ingest(projectId, [first]);
        yield* Deferred.await(f.entered);
        const current = (yield* service.get({ projectId, id: inboxIdentity(projectId, first) }))!;
        yield* service.mutate({
          projectId,
          id: current.id,
          commandId: CommandId.make("during-analysis"),
          expectedRevision: current.revision,
          action: { type: "irrelevant", irrelevant: true },
        });
        yield* service.ingest(projectId, [
          message("second", "urgent request", "2026-11-03T13:00:00Z", "first"),
        ]);
        yield* Deferred.succeed(f.release, undefined);
        yield* service.drainAnalysis;
        const next = (yield* service.get({ projectId, id: current.id }))!;
        assert.equal(next.relevance?.confidence, 3);
        assert.equal(next.state.irrelevant, undefined);
        assert.equal((yield* service.list({ projectId })).length, 1);
        assert.include((yield* service.references({ projectId }))[0]!.content, "Thanks");
      }).pipe(Effect.provide(f.layer));
    }).pipe(Effect.scoped),
);

it.effect("undo cannot overwrite a newer identical mark and can unwind each exact reference", () =>
  Effect.gen(function* () {
    const f = yield* fixture();
    yield* Effect.gen(function* () {
      const service = yield* Inbox.InboxService;
      const repository = yield* Repository.InboxRepository;
      const legacy = ingestInboxItem(projectId, message("legacy"));
      yield* repository.put(legacy);
      yield* service.drainAnalysis;
      const current = (yield* service.get({ projectId, id: legacy.id }))!;
      const input = {
        projectId,
        id: current.id,
        commandId: CommandId.make("first-mark"),
        expectedRevision: current.revision,
        action: { type: "irrelevant" as const, irrelevant: true },
      };
      const first = yield* service.mutate(input);
      const second = yield* service.mutate({
        ...input,
        commandId: CommandId.make("second-mark"),
        expectedRevision: first.notification.revision,
      });
      const undo = {
        projectId,
        id: current.id,
        commandId: CommandId.make("undo"),
        expectedRevision: second.notification.revision,
        action: { type: "undo" as const, commandId: CommandId.make("first-mark") },
      };
      assert.equal((yield* Effect.result(service.mutate(undo)))._tag, "Failure");
      assert.equal((yield* service.references({ projectId }))[0]?.id, "second-mark");
      const undone = yield* service.mutate({
        ...undo,
        action: { type: "undo", commandId: CommandId.make("second-mark") },
      });
      assert.equal((yield* service.references({ projectId }))[0]?.id, "first-mark");
      yield* service.mutate({
        ...undo,
        commandId: CommandId.make("undo-first"),
        expectedRevision: undone.notification.revision,
      });
      assert.deepEqual(yield* service.references({ projectId }), []);
      assert.equal((yield* service.list({ projectId })).length, 1);
    }).pipe(Effect.provide(f.layer));
  }).pipe(Effect.scoped),
);

it.effect(
  "first-sync history after adoption stays visible while the next incoming activity is assessed",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* Effect.gen(function* () {
        const service = yield* Inbox.InboxService;
        const imported = message("imported", "Thanks", "2026-11-03T12:00:00Z");
        const checkpoint = Date.parse("2026-11-03T13:00:00Z");
        yield* service.ingest(projectId, [imported], { relevanceSince: checkpoint });
        yield* service.drainAnalysis;
        assert.equal((yield* Ref.get(f.calls)).at(-1)?.classifyRelevance, false);
        assert.equal((yield* service.list({ projectId })).length, 1);
        assert.equal(
          (yield* service.get({ projectId, id: inboxIdentity(projectId, imported) }))?.relevance,
          undefined,
        );
        yield* service.ingest(
          projectId,
          [message("reply", "Thanks again", "2026-11-03T13:01:00Z", "imported")],
          { relevanceSince: checkpoint },
        );
        yield* service.drainAnalysis;
        assert.equal((yield* Ref.get(f.calls)).at(-1)?.classifyRelevance, true);
        assert.equal((yield* service.list({ projectId, visibility: "filtered" })).length, 1);
      }).pipe(Effect.provide(f.layer));
    }).pipe(Effect.scoped),
);

it.effect(
  "reprocessing an in-flight eligible summary transfers pending relevance to the replacement generation",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture(true);
      yield* Effect.gen(function* () {
        const service = yield* Inbox.InboxService;
        const first = message("pending");
        yield* service.ingest(projectId, [first]);
        yield* Deferred.await(f.entered);
        const current = (yield* service.get({ projectId, id: inboxIdentity(projectId, first) }))!;
        yield* service.mutate({
          projectId,
          id: current.id,
          commandId: CommandId.make("pending-reprocess"),
          expectedRevision: current.revision,
          action: { type: "reprocess" },
        });
        yield* Deferred.succeed(f.release, undefined);
        yield* service.drainAnalysis;
        const complete = (yield* service.get({ projectId, id: current.id }))!;
        assert.equal(complete.relevance?.status, "complete");
        assert.equal(complete.relevance?.version, complete.analysisVersion);
        assert.equal(complete.relevance?.irrelevant, true);
        assert.equal((yield* Ref.get(f.calls)).length, 2);
      }).pipe(Effect.provide(f.layer));
    }).pipe(Effect.scoped),
);

it.effect(
  "matches older relevant feedback within the bounded project history and keeps newer corrections first",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* Effect.gen(function* () {
        const analysis = yield* Analysis.InboxAnalysis;
        const current = ingestInboxItem(
          projectId,
          message("matching", "Thanks for confirming the deployment"),
        );
        const reference = (id: string, content: string, irrelevant = true) => ({
          id,
          content,
          irrelevant,
          projectId,
          notificationId: id,
          source: "slack" as const,
          createdAt: "2026-11-03T12:00:00Z",
        });
        const refs = [
          reference("correction", "Thanks for confirming the deployment", false),
          ...Array.from({ length: 13 }, (_, i) =>
            reference(`unrelated-${i}`, "Security incident requires immediate investigation"),
          ),
          reference("older-match", "Thanks for confirming the deployment"),
          {
            ...reference("foreign", "Thanks for confirming the deployment"),
            projectId: otherProject,
          },
        ];
        yield* analysis.analyze(
          {
            ...current,
            relevance: {
              version: current.analysisVersion,
              threshold: 98,
              status: "pending",
              confidence: null,
              irrelevant: false,
            },
          },
          [],
          refs,
        );
        assert.deepEqual((yield* Ref.get(f.calls))[0]?.relevanceReferences, [
          { content: "Thanks for confirming the deployment", irrelevant: false },
          { content: "Thanks for confirming the deployment", irrelevant: true },
        ]);
      }).pipe(Effect.provide(f.layer));
    }).pipe(Effect.scoped),
);

it.effect(
  "retained reference pages expose older snapshots without unbounding classification history",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* Effect.gen(function* () {
        const service = yield* Inbox.InboxService;
        const repository = yield* Repository.InboxRepository;
        for (let i = 0; i < 105; i++) {
          const current = {
            ...ingestInboxItem(projectId, message(`page-${i}`)),
            processingError: "Summary unavailable",
          };
          yield* repository.put(current);
          yield* service.mutate({
            projectId,
            id: current.id,
            commandId: CommandId.make(`reference-${i}`),
            expectedRevision: current.revision,
            action: { type: "irrelevant", irrelevant: true },
          });
        }
        const first = yield* service.references({ projectId });
        const second = yield* service.references({ projectId, offset: 100 });
        assert.equal(first.length, 100);
        assert.equal(second.length, 5);
        assert.equal(first[0]?.id, "reference-104");
        assert.equal(second.at(-1)?.id, "reference-0");
        assert.equal(new Set([...first, ...second].map((ref) => ref.id)).size, 105);
        assert.deepEqual(yield* service.references({ projectId, offset: 200 }), []);
        assert.equal((yield* repository.references(projectId)).length, 100);
      }).pipe(Effect.provide(f.layer));
    }).pipe(Effect.scoped),
);

it.effect(
  "current Inbox hides irrelevant and shows self activity regardless of retired visibility preferences",
  () =>
    Effect.gen(function* () {
      const f = yield* fixture();
      yield* Effect.gen(function* () {
        const service = yield* Inbox.InboxService;
        const settings = yield* Settings.ServerSettingsService;
        yield* settings.updateSettings({
          inboxFilterIrrelevant: false,
          inboxShowSelfReplies: false,
          inboxShowSelfUpdates: false,
        });
        const incoming = message("incoming");
        yield* service.ingest(projectId, [incoming, message("self-reply"), message("self-update")]);
        yield* service.drainAnalysis;
        yield* service.ingest(
          projectId,
          (["reply", "update"] as const).map((kind) => ({
            ...message(`self-${kind}`),
            replyActivity: [
              { id: `self-${kind}`, kind, isSelf: true, occurredAt: "2026-11-03T13:00:00Z" },
            ],
          })),
        );
        yield* service.drainAnalysis;
        assert.equal(
          (yield* service.get({ projectId, id: inboxIdentity(projectId, incoming) }))?.relevance
            ?.irrelevant,
          true,
        );
        assert.deepEqual(
          (yield* service.list({ projectId, visibility: "inbox" }))
            .map((row) => row.items[0]!.id)
            .sort(),
          ["self-reply", "self-update"],
        );
        assert.deepEqual(
          (yield* service.list({ projectId, visibility: "visible" })).map(
            (row) => row.items[0]!.id,
          ),
          ["incoming"],
        );
        assert.deepEqual(
          (yield* service.list({ projectId, visibility: "inbox", selfActivity: ["update"] })).map(
            (row) => row.items[0]!.id,
          ),
          ["self-update"],
        );
        assert.deepEqual(
          (yield* service.list({ projectId, visibility: "all", irrelevantOnly: true })).map(
            (row) => row.items[0]!.id,
          ),
          ["incoming"],
        );
      }).pipe(Effect.provide(f.layer));
    }).pipe(Effect.scoped),
);
