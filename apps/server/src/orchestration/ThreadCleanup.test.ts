import {
  ThreadId,
  ProjectId,
  ProviderInstanceId,
  ThreadCleanupError,
  type OrchestrationThreadShell,
  type ResourceMonitorProcessTableEntry,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Cleanup from "./ThreadCleanup.ts";
import * as Terminal from "../terminal/Manager.ts";
import * as Preview from "../preview/Manager.ts";
import * as Browser from "../mcp/PreviewAutomationBroker.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import * as Processes from "../process/ThreadProcesses.ts";
import * as Engine from "./Services/OrchestrationEngine.ts";
import * as Queries from "./Services/ProjectionSnapshotQuery.ts";
import {
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
  list: () => Effect.Effect<readonly ResourceMonitorProcessTableEntry[], ThreadCleanupError>;
  stop: Processes.ThreadProcesses["Service"]["stop"];
  dispatch: Engine.OrchestrationEngineService["Service"]["dispatch"];
  stopAgent?: () => Effect.Effect<void>;
}) {
  return Cleanup.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Terminal.TerminalManager)({ listForThread: () => Effect.succeed([]) }),
        Layer.mock(Preview.PreviewManager)({
          list: () => Effect.succeed({ serverEpoch: "test", revision: 0, sessions: [] }),
        }),
        Layer.mock(Browser.PreviewAutomationBroker)({ closeTab: () => Effect.void }),
        Layer.mock(ProviderService)({ stopSession: options.stopAgent ?? (() => Effect.void) }),
        Layer.succeed(Processes.ThreadProcesses, { list: options.list, stop: options.stop }),
        Layer.mock(Engine.OrchestrationEngineService)({ dispatch: options.dispatch }),
        Layer.mock(Queries.ProjectionSnapshotQuery)({
          getThreadShellById: () => Effect.succeed(Option.some(options.thread ?? shell)),
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

it.effect("keeps failure unresolved and permits retry without touching another chat", () =>
  Effect.gen(function* () {
    let attempts = 0;
    let alive = true;
    const commands: string[] = [];
    yield* Effect.gen(function* () {
      const service = yield* Cleanup.ThreadCleanup;
      yield* service.start({ threadId });
      expect((yield* finished(service))?.status).toBe("failed");
      expect(commands).toEqual([]);
      expect(isThreadClosing(threadId)).toBe(true);
      yield* service.start({ threadId });
      expect((yield* finished(service))?.status).toBe("complete");
      expect(attempts).toBe(2);
      expect(commands).toEqual(["thread.cleanup.complete"]);
    }).pipe(
      Effect.provide(
        testLayer({
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
