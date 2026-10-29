import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { expect, it } from "@effect/vitest";
import {
  DEFAULT_SERVER_SETTINGS,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ScheduledTaskId,
  ThreadId,
  type ServerSettings as ServerSettingsValue,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";
import * as TestClock from "effect/testing/TestClock";

import * as EventSink from "../orchestration-v2/EventSink.ts";
import { emptyProjection } from "../orchestration-v2/ProjectionStore.ts";
import * as ThreadLaunchService from "../orchestration-v2/ThreadLaunchService.ts";
import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as Scheduler from "../scheduling/Scheduler.ts";
import * as SecretRequests from "../secrets/SecretRequests.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ScheduledTaskService from "./ScheduledTaskService.ts";

const now = "2026-10-29T12:00:00.000Z";
const projectId = ProjectId.make("project:catch-up");
const threadId = ThreadId.make("thread:catch-up");
const createdAt = DateTime.makeUnsafe(now);
const projection = emptyProjection({
  id: EventId.make("event:catch-up"),
  type: "thread.created",
  threadId,
  occurredAt: createdAt,
  payload: {
    id: threadId,
    projectId,
    title: "Daily brief",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    createdBy: "user",
    creationSource: "web",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt,
    updatedAt: createdAt,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
  },
});

const seed = (
  id: string,
  options: { due?: string; enabled?: boolean; status?: string; schedule?: string } = {},
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO scheduled_tasks ${sql.insert({
      task_id: id,
      title: id,
      prompt: "A fresh brief",
      enabled: options.enabled === false ? 0 : 1,
      schedule_json: options.schedule ?? '{"type":"fixed_time","timeOfDay":"09:00"}',
      project_id: projectId,
      thread_id: null,
      workspace_strategy_json: '{"type":"root"}',
      model_selection_json: '{"instanceId":"codex","model":"gpt-5.4"}',
      runtime_mode: "full-access",
      interaction_mode: "default",
      created_by: "user",
      creation_source: "web",
      created_at: now,
      updated_at: now,
      next_run_at: options.due ?? "2026-10-15T07:00:00.000Z",
      last_run_at: null,
      last_run_status: options.status ?? "never",
      last_run_error: null,
      run_count: 0,
    })}`;
  });

// Building the service runs one scheduler poll.
const build = (
  settings: Effect.Effect<ServerSettingsValue>,
  launch: ThreadLaunchService.ThreadLaunchService["Service"]["launch"],
  sendToThread?: ThreadManagementService.ThreadManagementService["Service"]["sendToThread"],
) =>
  Layer.build(
    ScheduledTaskService.layer.pipe(
      Layer.provide(
        Layer.mergeAll(
          NodeCrypto.layer,
          Layer.mock(Scheduler.Scheduler)({ register: (_name, work) => work.pipe(Effect.orDie) }),
          Layer.mock(ServerSettings.ServerSettingsService)({ getSettings: settings }),
          Layer.mock(ThreadLaunchService.ThreadLaunchService)({ launch }),
          Layer.mock(ThreadManagementService.ThreadManagementService)(
            sendToThread ? { sendToThread } : {},
          ),
          Layer.mock(EventSink.EventSinkV2)({}),
          Layer.mock(SecretRequests.SecretRequests)({}),
        ),
      ),
    ),
  );

const poll = (...args: Parameters<typeof build>) => Effect.scoped(build(...args));

it.effect.each([
  { title: "environment opt-in", global: true, override: undefined, expected: 1 },
  { title: "project opt-in", global: false, override: true, expected: 1 },
  { title: "project opt-out", global: true, override: false, expected: 0 },
  { title: "default off", global: false, override: undefined, expected: 0 },
])("catches up once after weeks offline: $title", ({ global, override, expected }) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(now));
    yield* seed("brief");
    const settings = Effect.succeed({
      ...DEFAULT_SERVER_SETTINGS,
      automationCatchUpEnabled: global,
      projectSettingsOverrides:
        override === undefined ? {} : { [projectId]: { automationCatchUpEnabled: override } },
    });
    const launches = yield* Ref.make<ThreadLaunchService.ThreadLaunchInput[]>([]);
    const launch: ThreadLaunchService.ThreadLaunchService["Service"]["launch"] = (input) =>
      Ref.update(launches, (all) => [...all, input]).pipe(
        Effect.as({ threadId, projection, resumed: false }),
      );
    yield* poll(settings, launch);
    // A second startup must not dispatch the same overdue occurrence.
    yield* poll(settings, launch);
    expect((yield* Ref.get(launches)).length).toBe(expected);
    if (expected)
      expect((yield* Ref.get(launches))[0]).toMatchObject({
        initialMessage: { text: "A fresh brief" },
        workspaceStrategy: { type: "root" },
      });
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{
      run_count: number;
      next_run_at: string;
      last_run_status: string;
    }>`SELECT * FROM scheduled_tasks WHERE task_id = 'brief'`;
    expect(row?.run_count).toBe(expected);
    expect(Date.parse(row!.next_run_at)).toBeGreaterThan(Date.parse(now));
    expect(row?.last_run_status).toBe(expected ? "succeeded" : "never");
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("rechecks catch-up policy and task state after an earlier dispatch", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(now));
    for (const id of ["a-first", "b-disabled", "c-paused", "d-deleted", "e-postponed"])
      yield* seed(id);
    const settings = yield* Ref.make({
      ...DEFAULT_SERVER_SETTINGS,
      automationCatchUpEnabled: true,
    });
    const launched = yield* Ref.make<string[]>([]);
    const sql = yield* SqlClient.SqlClient;
    yield* poll(Ref.get(settings), (input) =>
      Effect.gen(function* () {
        yield* Ref.update(launched, (all) => [...all, input.title]);
        yield* Ref.update(settings, (value) => ({ ...value, automationCatchUpEnabled: false }));
        yield* sql`UPDATE scheduled_tasks SET enabled = 0 WHERE task_id = 'c-paused'`;
        yield* sql`DELETE FROM scheduled_tasks WHERE task_id = 'd-deleted'`;
        yield* sql`UPDATE scheduled_tasks SET next_run_at = '2026-11-01T09:00:00.000Z' WHERE task_id = 'e-postponed'`;
        return { threadId, projection, resumed: false };
      }).pipe(Effect.orDie),
    );
    expect(yield* Ref.get(launched)).toEqual(["a-first"]);
    const rows = yield* sql<{
      task_id: string;
      run_count: number;
      next_run_at: string;
    }>`SELECT * FROM scheduled_tasks ORDER BY task_id`;
    expect(rows.find((row) => row.task_id === "c-paused")?.run_count).toBe(0);
    expect(rows.find((row) => row.task_id === "e-postponed")?.next_run_at).toBe(
      "2026-11-01T09:00:00.000Z",
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("keeps paused, interval and interrupted-run recovery behavior", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(now));
    yield* seed("paused", { enabled: false });
    yield* seed("interrupted", { status: "running" });
    yield* seed("interval", { schedule: '{"type":"interval","everyMs":60000}' });
    const launched = yield* Ref.make<string[]>([]);
    yield* poll(Effect.succeed(DEFAULT_SERVER_SETTINGS), (input) =>
      Ref.update(launched, (all) => [...all, input.title]).pipe(
        Effect.as({ threadId, projection, resumed: false }),
      ),
    );
    expect(yield* Ref.get(launched)).toEqual(["interval"]);
    const sql = yield* SqlClient.SqlClient;
    const [row] = yield* sql<{
      last_run_status: string;
      run_count: number;
      next_run_at: string;
    }>`SELECT * FROM scheduled_tasks WHERE task_id = 'interrupted'`;
    expect(row?.last_run_status).toBe("failed");
    expect(row?.run_count).toBe(1);
    expect(Date.parse(row!.next_run_at)).toBeGreaterThan(Date.parse(now));
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("queues a catch-up in its existing chat and does not retry a failed dispatch", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(Date.parse(now));
    yield* seed("bound-brief");
    const sql = yield* SqlClient.SqlClient;
    yield* sql`UPDATE scheduled_tasks SET thread_id = ${threadId} WHERE task_id = 'bound-brief'`;
    const sent = yield* Ref.make<ThreadManagementService.ThreadManagementSendInput[]>([]);
    const settings = Effect.succeed({ ...DEFAULT_SERVER_SETTINGS, automationCatchUpEnabled: true });
    const launch = () => Effect.die("Bound catch-up must use its saved chat");
    const send: ThreadManagementService.ThreadManagementService["Service"]["sendToThread"] = (
      input,
    ) =>
      Ref.update(sent, (all) => [...all, input]).pipe(
        Effect.andThen(Effect.die("Dispatch failed")),
      );
    yield* poll(settings, launch, send);
    yield* poll(settings, launch, send);
    expect((yield* Ref.get(sent)).length).toBe(1);
    expect((yield* Ref.get(sent))[0]).toMatchObject({
      threadId,
      mode: "queue",
      text: "A fresh brief",
    });
    const [row] = yield* sql<{
      last_run_status: string;
      last_run_error: string;
      run_count: number;
    }>`SELECT * FROM scheduled_tasks WHERE task_id = 'bound-brief'`;
    expect(row?.last_run_status).toBe("failed");
    expect(row?.last_run_error).toContain("Dispatch failed");
    expect(row?.run_count).toBe(1);
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);

it.effect("records the runs a catch-up covered until the next run clears it", () =>
  Effect.gen(function* () {
    // Three days offline: the first missed slot plus three later daily slots in any time zone.
    yield* TestClock.setTime(Date.parse("2026-07-04T07:00:00.000Z"));
    yield* seed("brief", { due: "2026-07-01T07:00:00.000Z" });
    const settings = Effect.succeed({ ...DEFAULT_SERVER_SETTINGS, automationCatchUpEnabled: true });
    const launch = () => Effect.succeed({ threadId, projection, resumed: false });
    yield* Effect.scoped(
      Effect.gen(function* () {
        const service = Context.get(
          yield* build(settings, launch),
          ScheduledTaskService.ScheduledTaskService,
        );
        const task = service.list().pipe(Effect.map(({ tasks }) => tasks[0]));
        expect((yield* task)?.lastRunCatchUp).toEqual({
          missedSince: "2026-07-01T07:00:00.000Z",
          missedCount: 4,
        });
        yield* service.runNow({ id: ScheduledTaskId.make("brief") });
        expect((yield* task)?.lastRunCatchUp).toBeUndefined();
      }),
    );
  }).pipe(Effect.provide(SqlitePersistence.layerMemory)),
);
