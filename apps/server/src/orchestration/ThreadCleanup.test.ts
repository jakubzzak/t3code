import {
  ThreadId,
  ProjectId,
  ProviderInstanceId,
  ThreadCleanupError,
  DEFAULT_SERVER_SETTINGS,
  type ServerSettings,
  type OrchestrationThreadShell,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";
import { OrchestrationEventStore } from "../persistence/Services/OrchestrationEventStore.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { ThreadBackgroundLivenessService } from "./ThreadBackgroundLiveness.ts";
import * as Cleanup from "./ThreadCleanup.ts";
import * as Terminal from "../terminal/Manager.ts";
import * as Preview from "../preview/Manager.ts";
import * as Browser from "../mcp/PreviewAutomationBroker.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import * as Processes from "../process/ThreadProcesses.ts";
import * as Engine from "./Services/OrchestrationEngine.ts";
import * as Queries from "./Services/ProjectionSnapshotQuery.ts";
import {
  beginThreadCleanup,
  finishThreadCleanup,
  isThreadClosing,
  withThreadResourceLease,
  withThreadTurnLease,
} from "../process/threadResourceLease.ts";

const threadId = ThreadId.make("cleanup-test");
const shell: OrchestrationThreadShell = {
  id: threadId,
  projectId: ProjectId.make("project"),
  title: "Cleanup",
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
  runtimeMode: "full-access",
  interactionMode: "default",
  branch: null,
  worktreePath: null,
  pullRequests: [],
  latestTurn: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archivedAt: null,
  settledOverride: null,
  settledAt: null,
  session: null,
  latestUserMessageAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
};
const processEntry = { pid: 1234, ppid: 1, name: "detached server", startTimeMs: 123000 };

function testLayer(options: {
  thread?: OrchestrationThreadShell;
  list: Processes.ThreadProcesses["Service"]["list"];
  stop: Processes.ThreadProcesses["Service"]["stop"];
  dispatch: Engine.OrchestrationEngineService["Service"]["dispatch"];
  stopAgent?: () => Effect.Effect<void>;
  getThread?: Queries.ProjectionSnapshotQuery["Service"]["getThreadShellById"];
  hasEventAfter?: OrchestrationEventStore["Service"]["hasEventAfter"];
  settings?: ServerSettings;
  background?: ThreadBackgroundLivenessService["Service"]["getThreadBackgroundLiveness"];
  terminals?: Partial<Terminal.TerminalManager["Service"]>;
  previews?: Partial<Preview.PreviewManager["Service"]>;
  closeTab?: Browser.PreviewAutomationBroker["Service"]["closeTab"];
}) {
  return Cleanup.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Terminal.TerminalManager)({
          listForThread: () => Effect.succeed([]),
          ...options.terminals,
        }),
        Layer.mock(Preview.PreviewManager)({
          list: () => Effect.succeed({ serverEpoch: "test", revision: 0, sessions: [] }),
          ...options.previews,
        }),
        Layer.mock(Browser.PreviewAutomationBroker)({
          closeTab: options.closeTab ?? (() => Effect.void),
        }),
        Layer.mock(ProviderService)({ stopSession: options.stopAgent ?? (() => Effect.void) }),
        Layer.succeed(Processes.ThreadProcesses, { list: options.list, stop: options.stop }),
        Layer.mock(Engine.OrchestrationEngineService)({ dispatch: options.dispatch }),
        Layer.mock(Queries.ProjectionSnapshotQuery)({
          getThreadShellById:
            options.getThread ?? (() => Effect.succeed(Option.some(options.thread ?? shell))),
        }),
        Layer.mock(OrchestrationEventStore)({
          hasEventAfter: options.hasEventAfter ?? (() => Effect.succeed(false)),
        }),
        Layer.mock(ThreadBackgroundLivenessService)({
          recordTaskLiveness: () => {},
          clearThreadLiveness: () => {},
          getThreadBackgroundLiveness: options.background ?? (() => null),
        }),
        Layer.mock(ServerSettingsService)({
          getSettings: Effect.succeed(options.settings ?? DEFAULT_SERVER_SETTINGS),
        }),
      ),
    ),
    Layer.provide(NodeServices.layer),
  );
}

const finished = (service: Cleanup.ThreadCleanup["Service"]) =>
  service.subscribe(threadId).pipe(
    Stream.filter((state) => state !== null && state.status !== "closing"),
    Stream.runHead,
    Effect.map(Option.getOrThrow),
  );

it.effect("leaves the chat usable when the resource monitor is missing, then permits retry", () =>
  Effect.gen(function* () {
    const active = yield* Deferred.make<void>();
    let interrupted = false;
    let available = false;
    let stopped = false;
    const commands: string[] = [];
    yield* Effect.gen(function* () {
      const service = yield* Cleanup.ThreadCleanup;
      const turn = yield* withThreadTurnLease(
        threadId,
        Deferred.succeed(active, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(
            Effect.sync(() => {
              interrupted = true;
            }),
          ),
        ),
      ).pipe(Effect.exit, Effect.forkChild);
      yield* Deferred.await(active);
      const error = yield* service.start({ threadId, interruptAgent: true }).pipe(Effect.flip);
      expect(error.detail).toContain("Resource monitor binary was not found for darwin/arm64");
      expect(isThreadClosing(threadId)).toBe(false);
      expect(stopped).toBe(false);
      expect(interrupted).toBe(false);
      expect(commands).toEqual([]);
      yield* withThreadResourceLease(threadId, Effect.void);
      expect(yield* service.subscribe(threadId).pipe(Stream.runHead)).toEqual(Option.some(null));
      available = true;
      yield* service.start({ threadId, interruptAgent: true });
      expect((yield* finished(service))?.status).toBe("complete");
      expect((yield* Fiber.join(turn))._tag).toBe("Failure");
      expect(stopped).toBe(true);
      expect(commands).toEqual(["thread.session.set", "thread.cleanup.complete"]);
    }).pipe(
      Effect.provide(
        testLayer({
          thread: {
            ...shell,
            session: {
              threadId,
              status: "running",
              providerName: "Codex",
              runtimeMode: "full-access",
              activeTurnId: null,
              lastError: null,
              updatedAt: shell.updatedAt,
            },
          },
          list: () =>
            Effect.suspend(() =>
              available
                ? Effect.succeed([])
                : Effect.fail(
                    new ThreadCleanupError({
                      threadId,
                      detail:
                        "Resource monitor is unavailable: Resource monitor binary was not found for darwin/arm64.",
                    }),
                  ),
            ),
          stop: () => Effect.void,
          stopAgent: () =>
            Effect.sync(() => {
              stopped = true;
            }),
          dispatch: (command) =>
            Effect.sync(() => {
              commands.push(command.type);
              return { sequence: commands.length };
            }),
        }),
      ),
    );
  }).pipe(Effect.ensuring(Effect.sync(() => finishThreadCleanup(threadId)))),
);

it.effect("waits for verified process exit, blocks new launches, then resolves", () =>
  Effect.gen(function* () {
    const release = yield* Deferred.make<void>();
    const stopping = yield* Deferred.make<void>();
    let alive = true;
    const commands: string[] = [];
    yield* Effect.gen(function* () {
      const service = yield* Cleanup.ThreadCleanup;
      yield* service.start({ threadId });
      yield* Deferred.await(stopping);
      expect(commands).toEqual([]);
      expect(isThreadClosing(threadId)).toBe(true);
      const blocked = yield* withThreadResourceLease(threadId, Effect.die("must not launch")).pipe(
        Effect.flip,
      );
      expect(blocked._tag).toBe("ThreadCleanupError");
      yield* withThreadResourceLease("unrelated-chat", Effect.void);
      yield* Deferred.succeed(release, undefined);
      const result = yield* finished(service);
      expect(result?.status).toBe("complete");
      expect(result?.resources.every((row) => row.status === "closed")).toBe(true);
      expect(commands).toEqual(["thread.cleanup.complete"]);
      expect(isThreadClosing(threadId)).toBe(false);
    }).pipe(
      Effect.provide(
        testLayer({
          list: () => Effect.sync(() => (alive ? [processEntry] : [])),
          stop: () =>
            Deferred.succeed(stopping, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(
                Effect.sync(() => {
                  alive = false;
                }),
              ),
            ),
          dispatch: (command) =>
            Effect.sync(() => {
              commands.push(command.type);
              return { sequence: commands.length };
            }),
        }),
      ),
    );
  }).pipe(Effect.ensuring(Effect.sync(() => finishThreadCleanup(threadId)))),
);

for (const mode of ["manual", "automatic"] as const) {
  it.effect(
    `${mode} keeps failure unresolved and permits retry without touching another chat`,
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse("2026-01-10T00:00:00.000Z"));
        let attempts = 0;
        let alive = true;
        const commands: string[] = [];
        yield* Effect.gen(function* () {
          const service = yield* Cleanup.ThreadCleanup;
          yield* service.start({ threadId }, mode === "automatic" ? automatic : undefined);
          expect((yield* finished(service))?.status).toBe("failed");
          expect(commands).toEqual([]);
          expect(isThreadClosing(threadId)).toBe(true);
          yield* service.start({ threadId }, mode === "automatic" ? automatic : undefined);
          expect((yield* finished(service))?.status).toBe("complete");
          expect(attempts).toBe(2);
          expect(commands).toEqual(["thread.cleanup.complete"]);
        }).pipe(
          Effect.provide(
            testLayer({
              thread: { ...shell, latestUserMessageAt: shell.createdAt },
              list: () => Effect.sync(() => (alive ? [processEntry] : [])),
              stop: (target) =>
                Effect.suspend(() => {
                  expect(target).toBe(threadId);
                  if (++attempts === 1)
                    return Effect.fail(
                      new ThreadCleanupError({ threadId, detail: "Permission denied" }),
                    );
                  alive = false;
                  return Effect.void;
                }),
              dispatch: (command) =>
                Effect.sync(() => {
                  commands.push(command.type);
                  return { sequence: commands.length };
                }),
            }),
          ),
        );
      }).pipe(Effect.ensuring(Effect.sync(() => finishThreadCleanup(threadId)))),
  );
}

it.effect("requires confirmation for an active agent before any cleanup", () =>
  Effect.gen(function* () {
    let stopped = false;
    yield* Effect.gen(function* () {
      const service = yield* Cleanup.ThreadCleanup;
      const failure = yield* service.start({ threadId }).pipe(Effect.flip);
      expect(failure.confirmationRequired).toBe(true);
      expect(stopped).toBe(false);
      expect(isThreadClosing(threadId)).toBe(false);
      yield* service.start({ threadId, interruptAgent: true });
      expect((yield* finished(service))?.status).toBe("complete");
      expect(stopped).toBe(true);
    }).pipe(
      Effect.provide(
        testLayer({
          thread: {
            ...shell,
            session: {
              threadId,
              status: "running",
              providerName: "Codex",
              runtimeMode: "full-access",
              activeTurnId: null,
              lastError: null,
              updatedAt: shell.updatedAt,
            },
          },
          list: () => Effect.succeed([]),
          stop: () => Effect.void,
          stopAgent: () =>
            Effect.sync(() => {
              stopped = true;
            }),
          dispatch: () => Effect.succeed({ sequence: 1 }),
        }),
      ),
    );
  }).pipe(Effect.ensuring(Effect.sync(() => finishThreadCleanup(threadId)))),
);

it.effect("cancels an approval-blocked turn before draining its lease and stopping the agent", () =>
  Effect.gen(function* () {
    const active = yield* Deferred.make<void>();
    let finalized = false;
    let stopped = false;
    yield* Effect.gen(function* () {
      const service = yield* Cleanup.ThreadCleanup;
      const send = yield* withThreadTurnLease(
        threadId,
        Deferred.succeed(active, undefined).pipe(
          Effect.andThen(Effect.never),
          Effect.ensuring(
            Effect.sync(() => {
              finalized = true;
            }),
          ),
        ),
      ).pipe(Effect.exit, Effect.forkChild);
      yield* Deferred.await(active);
      yield* service.start({ threadId, interruptAgent: true });
      expect((yield* finished(service))?.status).toBe("complete");
      expect((yield* Fiber.join(send))._tag).toBe("Failure");
      expect(stopped).toBe(true);
      expect(beginThreadCleanup(threadId, false)).toBe(true);
      finishThreadCleanup(threadId);
    }).pipe(
      Effect.provide(
        testLayer({
          thread: {
            ...shell,
            session: {
              threadId,
              status: "running",
              providerName: "Cursor",
              runtimeMode: "full-access",
              activeTurnId: null,
              lastError: null,
              updatedAt: shell.updatedAt,
            },
          },
          list: () => Effect.succeed([]),
          stop: () => Effect.void,
          stopAgent: () =>
            Effect.sync(() => {
              expect(finalized).toBe(true);
              stopped = true;
            }),
          dispatch: () => Effect.succeed({ sequence: 1 }),
        }),
      ),
    );
  }).pipe(Effect.ensuring(Effect.sync(() => finishThreadCleanup(threadId)))),
);

it.effect("retries the captured birth identity of a child after its parent exits", () =>
  Effect.gen(function* () {
    const root = { ...processEntry, pid: 111, name: "shell" };
    const child = { ...processEntry, pid: 222, ppid: 111, name: "protected child" };
    let rootAlive = true;
    let childAlive = true;
    let attempts = 0;
    yield* Effect.gen(function* () {
      const service = yield* Cleanup.ThreadCleanup;
      yield* service.start({ threadId });
      expect((yield* finished(service))?.status).toBe("failed");
      expect(childAlive).toBe(true);
      yield* service.start({ threadId });
      const retried = yield* finished(service);
      expect(retried?.status).toBe("complete");
      expect(childAlive).toBe(false);
      expect(attempts).toBe(2);
      expect(
        retried?.resources.find((row) => row.id === `process:${child.pid}:${child.startTimeMs}`)
          ?.status,
      ).toBe("closed");
    }).pipe(
      Effect.provide(
        testLayer({
          list: () => Effect.sync(() => (rootAlive ? [root, child] : [])),
          stop: (_, entry) =>
            Effect.suspend(() => {
              if (entry.pid === root.pid) {
                rootAlive = false;
                return Effect.void;
              }
              expect(entry).toEqual(child);
              if (++attempts === 1)
                return Effect.fail(
                  new ThreadCleanupError({ threadId, detail: "Transient process-table failure" }),
                );
              childAlive = false;
              return Effect.void;
            }),
          dispatch: () => Effect.succeed({ sequence: 1 }),
        }),
      ),
    );
  }).pipe(Effect.ensuring(Effect.sync(() => finishThreadCleanup(threadId)))),
);

const automatic = {
  snapshotSequence: 10,
  settledAt: shell.createdAt,
  pullRequest: null,
};
const idleThread = {
  ...shell,
  latestUserMessageAt: shell.createdAt,
  session: {
    threadId,
    status: "ready" as const,
    providerName: "Codex",
    runtimeMode: "full-access" as const,
    activeTurnId: null,
    lastError: null,
    updatedAt: shell.updatedAt,
  },
};

for (const mode of ["manual", "automatic"] as const) {
  it.effect(
    `${mode} settlement verifies all owned tools closed and leaves another chat untouched`,
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse("2026-01-10T00:00:00.000Z"));
        const otherId = ThreadId.make("unrelated-chat");
        const terminalRows = [threadId, otherId].map((id) => ({
          threadId: id,
          terminalId: "default",
          cwd: "/same/workspace",
          worktreePath: null,
          status: "running" as const,
          pid: id === threadId ? 1234 : 5678,
          exitCode: null,
          exitSignal: null,
          hasRunningSubprocess: true,
          label: "dev server",
          history: "",
          updatedAt: shell.updatedAt,
        }));
        const tabs = [threadId, otherId].map((id) => ({
          threadId: id,
          tabId: "tab",
          navStatus: { _tag: "Idle" as const },
          canGoBack: false,
          canGoForward: false,
          updatedAt: shell.updatedAt,
        }));
        const processes = new Map([
          [threadId, [processEntry]],
          [otherId, [{ ...processEntry, pid: 5678 }]],
        ]);
        const agents = new Set([threadId, otherId]);
        const browsers = new Set([threadId, otherId]);
        const stopped = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const commands: Parameters<Engine.OrchestrationEngineService["Service"]["dispatch"]>[0][] =
          [];
        yield* Effect.gen(function* () {
          const cleanup = yield* Cleanup.ThreadCleanup;
          yield* cleanup.start({ threadId }, mode === "automatic" ? automatic : undefined);
          yield* Deferred.await(stopped);
          expect(commands).toEqual([]);
          expect(terminalRows).toHaveLength(2);
          yield* Deferred.succeed(release, undefined);
          expect((yield* finished(cleanup))?.status).toBe("complete");
          expect(terminalRows.map((row) => row.threadId)).toEqual([otherId]);
          expect(tabs.map((tab) => tab.threadId)).toEqual([otherId]);
          expect([...agents]).toEqual([otherId]);
          expect([...browsers]).toEqual([otherId]);
          expect(processes.get(otherId)).toHaveLength(1);
          expect(commands.map((command) => command.type)).toEqual([
            "thread.session.set",
            "thread.cleanup.complete",
          ]);
          expect(commands.at(-1)).toMatchObject({
            threadId,
            ...(mode === "automatic" ? { settledAt: automatic.settledAt } : {}),
          });
        }).pipe(
          Effect.provide(
            testLayer({
              thread: idleThread,
              list: (id) => Effect.sync(() => processes.get(id) ?? []),
              stop: (id) =>
                Deferred.succeed(stopped, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.andThen(
                    Effect.sync(() => {
                      processes.delete(id);
                    }),
                  ),
                ),
              stopAgent: () =>
                Effect.sync(() => {
                  agents.delete(threadId);
                }),
              terminals: {
                listForThread: (id) =>
                  Effect.succeed(terminalRows.filter((row) => row.threadId === id)),
                close: ({ threadId: id }) =>
                  Effect.sync(() => {
                    terminalRows.splice(
                      terminalRows.findIndex((row) => row.threadId === id),
                      1,
                    );
                  }),
              },
              previews: {
                list: ({ threadId: id }) =>
                  Effect.succeed({
                    serverEpoch: "test",
                    revision: 0,
                    sessions: tabs.filter((tab) => tab.threadId === id),
                  }),
                close: ({ threadId: id }) =>
                  Effect.sync(() => {
                    tabs.splice(
                      tabs.findIndex((tab) => tab.threadId === id),
                      1,
                    );
                  }),
              },
              closeTab: (id) =>
                Effect.sync(() => {
                  browsers.delete(id);
                }),
              dispatch: (command) =>
                Effect.sync(() => {
                  commands.push(command);
                  return { sequence: commands.length };
                }),
            }),
          ),
        );
      }).pipe(Effect.ensuring(Effect.sync(() => finishThreadCleanup(threadId)))),
  );
}

for (const reason of [
  "stale",
  "running",
  "approval",
  "opt-out",
  "settings",
  "background",
  "queued-turn",
  "live-background",
] as const) {
  it.effect(`skips automatic cleanup when ${reason} changes during process discovery`, () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-01-10T00:00:00.000Z"));
      let discovered = false;
      let interrupted = false;
      const active = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      yield* Effect.gen(function* () {
        const cleanup = yield* Cleanup.ThreadCleanup;
        const turn =
          reason === "queued-turn"
            ? yield* withThreadTurnLease(
                threadId,
                Deferred.succeed(active, undefined).pipe(
                  Effect.andThen(Deferred.await(release)),
                  Effect.onInterrupt(() =>
                    Effect.sync(() => {
                      interrupted = true;
                    }),
                  ),
                ),
              ).pipe(Effect.forkChild)
            : null;
        if (turn) yield* Deferred.await(active);
        const failure = yield* cleanup.start({ threadId }, automatic).pipe(Effect.flip);
        expect(failure._tag).toBe("ThreadCleanupError");
        expect(isThreadClosing(threadId)).toBe(false);
        expect(interrupted).toBe(false);
        yield* withThreadResourceLease(threadId, Effect.void);
        if (turn) {
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(turn);
        }
      }).pipe(
        Effect.provide(
          testLayer({
            getThread: () =>
              Effect.sync(() =>
                Option.some({
                  ...idleThread,
                  ...(discovered && reason === "running"
                    ? { session: { ...idleThread.session, status: "running" as const } }
                    : {}),
                  ...(discovered && reason === "approval" ? { hasPendingApprovals: true } : {}),
                  ...(discovered && reason === "opt-out"
                    ? { autoSettleDisabledAt: shell.updatedAt }
                    : {}),
                  ...(discovered && reason === "background"
                    ? { backgroundLiveness: "working" as const }
                    : {}),
                }),
              ),
            background: () => (discovered && reason === "live-background" ? "working" : null),
            hasEventAfter: (input) =>
              Effect.sync(() => {
                expect(input).toEqual({
                  aggregateKind: "thread",
                  aggregateId: threadId,
                  sequenceExclusive: 10,
                });
                return reason === "stale";
              }),
            ...(reason === "settings"
              ? {
                  settings: {
                    ...DEFAULT_SERVER_SETTINGS,
                    sidebarAutoSettleAfterDays: null,
                    sidebarAutoSettleOnMerge: false,
                  },
                }
              : {}),
            list: () =>
              Effect.sync(() => {
                discovered = true;
                return [];
              }),
            stop: () => Effect.die("Must not stop processes"),
            stopAgent: () => Effect.die("Must not stop agent"),
            dispatch: () => Effect.die("Must not settle chat"),
          }),
        ),
      );
    }).pipe(Effect.ensuring(Effect.sync(() => finishThreadCleanup(threadId)))),
  );
}
