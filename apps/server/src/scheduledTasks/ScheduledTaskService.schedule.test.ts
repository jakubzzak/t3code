import { DEFAULT_SERVER_SETTINGS } from "@t3tools/contracts";
import * as ServerSettings from "../serverSettings.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import { ScheduledTaskUpsertInput } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ManagedProjectFolders from "../project/ManagedProjectFolders.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";
import * as ManagedPolicy from "../policy/ManagedPolicy.ts";

const decodeUpsertInput = Schema.decodeUnknownEffect(ScheduledTaskUpsertInput);

it.effect("rejects a stale form save after deletion while preserving explicit-id creates", () =>
  Effect.gen(function* () {
    const layerDependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      Layer.mock(ServerSettings.ServerSettingsService)({
        getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
      }),
      ManagedPolicy.layerTest(),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/projects",
        isScratchProject: () => Effect.succeed(false),
      }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(EventSink.EventSinkV2)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const input = yield* decodeUpsertInput({
        id: "scheduled-task:edit-after-delete",
        title: "Review",
        prompt: "Review the open pull requests.",
        enabled: true,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId: "project-stale-schedule",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const created = yield* service.upsert(input);
      const edit = yield* decodeUpsertInput({ ...input, requireExisting: true, title: "Edited" });
      expect((yield* service.upsert(edit)).task.title).toBe("Edited");
      yield* service.delete({ id: created.task.id });

      const failure = yield* service.upsert(edit).pipe(Effect.flip);
      expect(failure.message).toBe("Schedule task not found.");
      expect((yield* service.list()).tasks).toEqual([]);

      expect((yield* service.upsert(input)).task.id).toBe(created.task.id);
    }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(layerDependencies))));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("preserves a due run when a save only pads the scheduled hour", () =>
  Effect.gen(function* () {
    const dueAt = DateTime.makeZonedUnsafe(
      { year: 2026, month: 7, day: 1, hour: 9, minute: 0, second: 0, millisecond: 0 },
      { timeZone: DateTime.zoneMakeLocal(), adjustForTimeZone: true },
    );
    yield* TestClock.setTime(DateTime.toEpochMillis(dueAt) - 1_000);

    const layerDependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      Layer.mock(ServerSettings.ServerSettingsService)({
        getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
      }),
      ManagedPolicy.layerTest(),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/projects",
        isScratchProject: () => Effect.succeed(false),
      }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(EventSink.EventSinkV2)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const input = yield* decodeUpsertInput({
        commandId: "schedule-time-format",
        title: "Morning review",
        prompt: "Review the open pull requests.",
        enabled: true,
        schedule: { type: "fixed_time", timeOfDay: "9:00" },
        projectId: "project-schedule-time-format",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
        creationSource: "mcp",
      });
      const created = yield* service.upsert(input);
      const expectedDueAt = DateTime.formatIso(DateTime.toUtc(dueAt));
      expect(created.task.nextRunAt).toBe(expectedDueAt);

      yield* TestClock.setTime(DateTime.toEpochMillis(dueAt) + 1_000);
      const update = yield* decodeUpsertInput({
        ...input,
        id: created.task.id,
        schedule: { type: "fixed_time", timeOfDay: "09:00" },
      });
      const updated = yield* service.upsert(update);
      expect(updated.task.nextRunAt).toBe(expectedDueAt);
      expect((yield* service.list()).tasks[0]?.nextRunAt).toBe(expectedDueAt);

      const rescheduled = yield* service.upsert({
        ...update,
        schedule: { type: "fixed_time", timeOfDay: "09:30" },
      });
      expect(rescheduled.task.nextRunAt).toBe(
        DateTime.formatIso(DateTime.toUtc(DateTime.add(dueAt, { minutes: 30 }))),
      );
    }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(layerDependencies))));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("validates chat bindings and prevents resuming an archived destination", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO orchestration_v2_projection_threads (
      thread_id, project_id, title, default_provider, provider_instance_id,
      runtime_mode, interaction_mode, created_at, updated_at, archived_at, payload_json
    ) VALUES ('chat', 'project', 'Daily brief', 'codex', 'codex', 'full-access', 'default',
      '2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', NULL, '{"settledAt":"2026-10-01T00:00:00Z"}')`;
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const input = yield* decodeUpsertInput({
        id: "binding",
        title: "Daily brief",
        prompt: "Summarize the day",
        enabled: true,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId: "project",
        threadId: "chat",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const wrongProject = yield* decodeUpsertInput({ ...input, projectId: "other" });
      expect((yield* service.upsert(wrongProject).pipe(Effect.result))._tag).toBe("Failure");
      const missing = yield* decodeUpsertInput({ ...input, threadId: "missing" });
      expect((yield* service.upsert(missing).pipe(Effect.result))._tag).toBe("Failure");
      const created = yield* service.upsert(input);
      expect(created.task.threadId).toBe("chat");
      yield* service.setEnabled({ id: created.task.id, enabled: false });
      yield* sql`UPDATE orchestration_v2_projection_threads SET archived_at = '2026-10-02T00:00:00Z' WHERE thread_id = 'chat'`;
      expect((yield* service.upsert(input).pipe(Effect.result))._tag).toBe("Failure");
      expect(
        (yield* service.setEnabled({ id: created.task.id, enabled: true }).pipe(Effect.result))
          ._tag,
      ).toBe("Failure");
      // A paused binding stays manageable without allowing new archived destinations.
      expect(
        (yield* service.upsert({ ...input, enabled: false, title: "Paused brief" })).task.title,
      ).toBe("Paused brief");
      const another = yield* decodeUpsertInput({ ...input, id: "another", enabled: false });
      expect((yield* service.upsert(another).pipe(Effect.result))._tag).toBe("Failure");
      yield* sql`UPDATE scheduled_tasks SET enabled = 1 WHERE task_id = 'binding'`;
      expect(
        (yield* service.setEnabled({ id: created.task.id, enabled: true }).pipe(Effect.result))
          ._tag,
      ).toBe("Failure");
      const unbound = yield* service.upsert({ ...input, threadId: null });
      expect(unbound.task.threadId).toBeNull();
      expect(unbound.task.prompt).toBe(input.prompt);
      expect(unbound.task.schedule).toEqual(input.schedule);
    }).pipe(
      Effect.provide(
        ScheduledTaskService.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              NodeCrypto.layer,
              Scheduler.layer,
              Layer.mock(ServerSettings.ServerSettingsService)({
                getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
              }),
              ManagedPolicy.layerTest(),
              Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
              Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
                namedProjectsRoot: "/projects",
                isScratchProject: () => Effect.succeed(false),
              }),
              Layer.mock(ThreadManagementService.ThreadManagementService)({}),
              Layer.mock(EventSink.EventSinkV2)({}),
              Layer.mock(SecretRequests.SecretRequests)({}),
            ),
          ),
        ),
      ),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("resumes a paused fixed-time automation at its next future occurrence", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-10-01T12:00:00Z"));
    yield* Effect.gen(function* () {
      const tasks = yield* ScheduledTaskService.ScheduledTaskService;
      const input = yield* decodeUpsertInput({
        title: "Daily brief",
        prompt: "A fresh brief",
        enabled: false,
        schedule: { type: "fixed_time", timeOfDay: "09:00" },
        projectId: "project-paused",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const { task } = yield* tasks.upsert(input);
      expect(task.nextRunAt).toBeNull();
      yield* TestClock.setTime(Date.parse("2026-10-29T12:00:00Z"));
      const resumed = yield* tasks.setEnabled({ id: task.id, enabled: true });
      expect(Date.parse(resumed.task.nextRunAt!)).toBeGreaterThan(
        Date.parse("2026-10-29T12:00:00Z"),
      );
      expect(resumed.task.runCount).toBe(0);
    }).pipe(
      Effect.provide(
        ScheduledTaskService.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              NodeCrypto.layer,
              Layer.mock(Scheduler.Scheduler)({ register: () => Effect.void }),
              Layer.mock(ServerSettings.ServerSettingsService)({
                getSettings: Effect.succeed({
                  ...DEFAULT_SERVER_SETTINGS,
                  automationCatchUpEnabled: true,
                }),
              }),
              ManagedPolicy.layerTest(),
              Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
              Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
                namedProjectsRoot: "/projects",
                isScratchProject: () => Effect.succeed(false),
              }),
              Layer.mock(ThreadManagementService.ThreadManagementService)({}),
              Layer.mock(EventSink.EventSinkV2)({}),
              Layer.mock(SecretRequests.SecretRequests)({}),
            ),
          ),
        ),
      ),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),

);

it.effect("keeps the task list order when a toggle or edit rewrites updated_at", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse("2026-07-01T09:00:00.000Z"));
    const layerDependencies = Layer.mergeAll(
      NodeCrypto.layer,
      Scheduler.layer,
      Layer.mock(ServerSettings.ServerSettingsService)({
        getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
      }),
      ManagedPolicy.layerTest(),
      Layer.mock(ThreadLaunchService.ThreadLaunchService)({}),
      Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
        namedProjectsRoot: "/projects",
        isScratchProject: () => Effect.succeed(false),
      }),
      Layer.mock(ThreadManagementService.ThreadManagementService)({}),
      Layer.mock(EventSink.EventSinkV2)({}),
      Layer.mock(SecretRequests.SecretRequests)({}),
    );
    yield* Effect.gen(function* () {
      const service = yield* ScheduledTaskService.ScheduledTaskService;
      const input = (id: string) => ({
        id,
        title: id,
        prompt: "Review the open pull requests.",
        enabled: true,
        schedule: { type: "interval", everyMs: 60_000 },
        projectId: "project-stable-order",
        workspaceStrategy: { type: "root" },
        modelSelection: { instanceId: "codex", model: "gpt-5.4" },
        runtimeMode: "full-access",
        interactionMode: "default",
      });
      const listedIds = service
        .list()
        .pipe(Effect.map(({ tasks }) => tasks.map((task) => String(task.id))));

      const older = yield* service.upsert(yield* decodeUpsertInput(input("scheduled-task:older")));
      yield* TestClock.adjust("1 second");
      yield* service.upsert(yield* decodeUpsertInput(input("scheduled-task:newer")));
      const order = ["scheduled-task:newer", "scheduled-task:older"];
      expect(yield* listedIds).toEqual(order);

      yield* TestClock.adjust("1 second");
      const toggled = yield* service.setEnabled({ id: older.task.id, enabled: false });
      expect(toggled.task.updatedAt > older.task.updatedAt).toBe(true);
      expect(yield* listedIds).toEqual(order);

      yield* TestClock.adjust("1 second");
      const edit = { ...input(older.task.id), requireExisting: true, title: "Edited" };
      yield* service.upsert(yield* decodeUpsertInput({ ...edit, enabled: false }));
      expect(yield* listedIds).toEqual(order);
    }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(layerDependencies))));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect(
  "idle polls still wake for tasks saved later, recorded due times, and beside far-future tasks",
  () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-07-01T09:00:00.000Z"));
      const launched = yield* Deferred.make<string>();
      const layerDependencies = Layer.mergeAll(
        NodeCrypto.layer,
        Scheduler.layer,
        Layer.mock(ServerSettings.ServerSettingsService)({
          getSettings: Effect.succeed(DEFAULT_SERVER_SETTINGS),
        }),
        ManagedPolicy.layerTest(),
        Layer.mock(ThreadLaunchService.ThreadLaunchService)({
          launch: (input) =>
            Deferred.succeed(launched, input.title).pipe(
              Effect.as({ threadId: "thread-idle-poll", resumed: false } as never),
            ),
        }),
        Layer.mock(ManagedProjectFolders.ManagedProjectFolders)({
          namedProjectsRoot: "/projects",
          isScratchProject: () => Effect.succeed(false),
        }),
        Layer.mock(ThreadManagementService.ThreadManagementService)({}),
        Layer.mock(EventSink.EventSinkV2)({}),
        Layer.mock(SecretRequests.SecretRequests)({}),
      );
      yield* Effect.gen(function* () {
        const service = yield* ScheduledTaskService.ScheduledTaskService;
        // The first poll finds no tasks and remembers that nothing is due.
        yield* TestClock.adjust("6 seconds");
        // Its year-10000+ next run sorts first as text; it must not hide the task below.
        yield* service.upsert(
          yield* decodeUpsertInput({
            title: "Far future",
            prompt: "Review the open pull requests.",
            enabled: true,
            schedule: { type: "interval", everyMs: 3e14 },
            projectId: "project-idle-poll",
            workspaceStrategy: { type: "root" },
            modelSelection: { instanceId: "codex", model: "gpt-5.4" },
            runtimeMode: "full-access",
            interactionMode: "default",
          }),
        );
        const created = yield* service.upsert(
          yield* decodeUpsertInput({
            title: "Idle poll",
            prompt: "Review the open pull requests.",
            enabled: true,
            schedule: { type: "interval", everyMs: 60_000 },
            projectId: "project-idle-poll",
            workspaceStrategy: { type: "root" },
            modelSelection: { instanceId: "codex", model: "gpt-5.4" },
            runtimeMode: "full-access",
            interactionMode: "default",
          }),
        );
        // This poll records the new task's due time; the later ones must still fire it.
        yield* TestClock.adjust("6 seconds");
        yield* TestClock.adjust("60 seconds");
        expect(yield* Deferred.await(launched)).toBe(created.task.title);
      }).pipe(Effect.provide(ScheduledTaskService.layer.pipe(Layer.provide(layerDependencies))));
    }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
