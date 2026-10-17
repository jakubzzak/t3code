import {
  CommandId,
  ThreadCleanupError,
  type ThreadCleanupInput,
  type ThreadCleanupResource,
  type ThreadCleanupSnapshot,
  type ThreadId,
  type ResourceMonitorProcessTableEntry,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TerminalManager from "../terminal/Manager.ts";
import * as PreviewManager from "../preview/Manager.ts";
import * as ThreadProcesses from "../process/ThreadProcesses.ts";
import { ThreadManagementService } from "./ThreadManagementService.ts";
import { EffectOutboxV2 } from "./EffectOutbox.ts";
import {
  beginThreadCleanup,
  finishThreadCleanup,
  withThreadResourceLease,
} from "../process/threadResourceLease.ts";

export class ThreadCleanup extends Context.Service<
  ThreadCleanup,
  {
    readonly start: (
      input: ThreadCleanupInput,
      automatic?: {
        readonly snapshotAt: DateTime.Utc;
        readonly settledAt: DateTime.Utc;
      },
    ) => Effect.Effect<ThreadCleanupSnapshot, ThreadCleanupError>;
    readonly subscribe: (threadId: ThreadId) => Stream.Stream<ThreadCleanupSnapshot | null>;
  }
>()("t3/orchestration-v2/ThreadCleanup") {}

const isCleanupError = Schema.is(ThreadCleanupError);

const make = Effect.gen(function* () {
  const scope = yield* Scope.Scope;
  const crypto = yield* Crypto.Crypto;
  const terminals = yield* TerminalManager.TerminalManager;
  const previews = yield* PreviewManager.PreviewManager;
  const processes = yield* ThreadProcesses.ThreadProcesses;
  const engine = yield* ThreadManagementService;
  const outbox = yield* EffectOutboxV2;
  const queries = {
    getThreadShellById: (threadId: ThreadId) =>
      engine.getThreadShell(threadId).pipe(Effect.map(Option.fromNullishOr)),
  };
  const dispatchAndWait = Effect.fnUntraced(function* (
    command: Extract<
      Parameters<typeof engine.dispatch>[0],
      { type: "thread.stop" | "thread.settle" | "thread.auto-settle" }
    >,
  ) {
    yield* engine.dispatch(command);
    const effects = yield* outbox.listByCommandId(command.commandId);
    yield* Effect.forEach(effects, (effect) => outbox.awaitSettled(effect.id), { discard: true });
    const completed = yield* outbox.listByCommandId(command.commandId);
    if (completed.some((effect) => effect.status === "failed")) {
      return yield* new ThreadCleanupError({
        threadId: command.threadId,
        detail: "Provider cleanup failed. Retry to finish.",
      });
    }
  });
  const states = yield* SubscriptionRef.make(new Map<ThreadId, ThreadCleanupSnapshot>());
  const running = new Map<ThreadId, string>();
  // A captured child can lose its ownership marker and ancestry when its parent exits.
  // Keep its birth identity until verified stopped, including across Retry.
  const pendingProcesses = new Map<ThreadId, Map<string, ResourceMonitorProcessTableEntry>>();
  const rememberProcesses = (
    threadId: ThreadId,
    entries: readonly ResourceMonitorProcessTableEntry[],
  ) => {
    const pending =
      pendingProcesses.get(threadId) ?? new Map<string, ResourceMonitorProcessTableEntry>();
    for (const entry of entries) pending.set(`${entry.pid}:${entry.startTimeMs}`, entry);
    pendingProcesses.set(threadId, pending);
    return pending;
  };

  const update = (threadId: ThreadId, f: (state: ThreadCleanupSnapshot) => ThreadCleanupSnapshot) =>
    SubscriptionRef.update(states, (map) => {
      const current = map.get(threadId);
      return current ? new Map(map).set(threadId, f(current)) : map;
    });
  const resource = (threadId: ThreadId, row: ThreadCleanupResource) =>
    update(threadId, (state) => ({
      ...state,
      resources: state.resources.some((entry) => entry.id === row.id)
        ? state.resources.map((entry) => (entry.id === row.id ? row : entry))
        : [...state.resources, row],
    }));
  const attempt = Effect.fnUntraced(function* <E>(
    threadId: ThreadId,
    row: ThreadCleanupResource,
    action: Effect.Effect<unknown, E>,
  ) {
    yield* resource(threadId, { ...row, status: "closing" });
    return yield* action.pipe(
      Effect.matchEffect({
        onSuccess: (result) =>
          resource(threadId, {
            ...row,
            status: "closed",
            ...(result === "not-applicable" ? { notApplicable: true } : {}),
          }).pipe(Effect.as(true)),
        onFailure: (error) =>
          resource(threadId, {
            ...row,
            status: "failed",
            error:
              error instanceof Error
                ? error.message
                : "Could not close this resource. Retry cleanup.",
          }).pipe(Effect.as(false)),
      }),
    );
  });
  const commandId = crypto.randomUUIDv4().pipe(
    Effect.orDie,
    Effect.map((id) => CommandId.make(`cleanup:${id}`)),
  );

  const run = Effect.fn("ThreadCleanup.run")(function* (
    threadId: ThreadId,
    automatic?: Parameters<ThreadCleanup["Service"]["start"]>[1],
  ) {
    let shell = yield* queries.getThreadShellById(threadId);
    if (Option.isNone(shell))
      return yield* new ThreadCleanupError({ threadId, detail: "Chat no longer exists." });
    const thread = shell.value;
    // Commands already in flight have drained before this exclusive lease is acquired.
    if (
      automatic &&
      (thread.archivedAt !== null ||
        thread.settledOverride !== null ||
        DateTime.toEpochMillis(thread.updatedAt) > DateTime.toEpochMillis(automatic.snapshotAt) ||
        thread.activeRunId !== null ||
        thread.pendingRuntimeRequest !== null ||
        (thread.pendingBackgroundTasks?.length ?? 0) > 0 ||
        ["queued", "preparing", "starting", "running", "waiting"].includes(thread.status))
    ) {
      finishThreadCleanup(threadId);
      return yield* new ThreadCleanupError({
        threadId,
        detail: "Chat changed before automatic cleanup acquired its lease.",
      });
    }
    const terminalList = yield* terminals.listForThread(threadId);
    const discovered = yield* processes.list(
      threadId,
      terminalList.flatMap((terminal) => (terminal.pid === null ? [] : [terminal.pid])),
    );
    const owned = [...rememberProcesses(threadId, discovered).values()];
    const previewList = yield* previews.list({ threadId });
    const rows: ThreadCleanupResource[] = [
      ...(!automatic
        ? [
            {
              id: "agent",
              label: `Agent session`,
              kind: "agent" as const,
              status: "closing" as const,
            },
          ]
        : []),
      ...terminalList.map((terminal) => ({
        id: `terminal:${terminal.terminalId}`,
        label: terminal.label || terminal.terminalId,
        kind: "terminal" as const,
        status: "closing" as const,
      })),
      ...owned.map((entry) => ({
        id: `process:${entry.pid}:${entry.startTimeMs}`,
        label: `${entry.name} (${entry.pid})`,
        kind: "process" as const,
        status: "closing" as const,
      })),
      ...previewList.sessions.map((tab) => ({
        id: `browser:${tab.tabId}`,
        label: tab.navStatus._tag === "Idle" ? "Browser tab" : tab.navStatus.url,
        kind: "browser" as const,
        status: "closing" as const,
      })),
    ];
    yield* update(threadId, (state) => ({
      ...state,
      resources: [
        ...state.resources.filter(
          (row) => row.status === "closed" && !rows.some((next) => next.id === row.id),
        ),
        ...rows,
      ],
    }));
    let succeeded = true;
    if (!automatic) {
      succeeded = yield* attempt(
        threadId,
        rows.find((row) => row.id === "agent")!,
        dispatchAndWait({ type: "thread.stop", commandId: yield* commandId, threadId }),
      );
    }
    // Scan again after stopping the agent to include jobs launched during teardown.
    const remaining = yield* processes.list(threadId);
    const pending = rememberProcesses(threadId, remaining);
    const targets = [...pending.values()];
    const stopped = yield* Effect.forEach(
      targets,
      (entry) =>
        attempt(
          threadId,
          {
            id: `process:${entry.pid}:${entry.startTimeMs}`,
            label: `${entry.name} (${entry.pid})`,
            kind: "process",
            status: "closing",
          },
          processes.stop(threadId, entry).pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                pending.delete(`${entry.pid}:${entry.startTimeMs}`);
              }),
            ),
          ),
        ),
      { concurrency: 4 },
    );
    succeeded = stopped.every(Boolean) && succeeded;
    if (succeeded) {
      const terminalsClosed = yield* Effect.forEach(
        terminalList,
        (terminal) =>
          attempt(
            threadId,
            {
              id: `terminal:${terminal.terminalId}`,
              label: terminal.label || terminal.terminalId,
              kind: "terminal",
              status: "closing",
            },
            terminals.close({ threadId, terminalId: terminal.terminalId }),
          ),
        { concurrency: 4 },
      );
      succeeded = terminalsClosed.every(Boolean);
    }
    const browsersClosed = yield* Effect.forEach(
      previewList.sessions,
      (tab) =>
        attempt(
          threadId,
          {
            id: `browser:${tab.tabId}`,
            label: tab.navStatus._tag === "Idle" ? "Browser tab" : tab.navStatus.url,
            kind: "browser",
            status: "closing",
          },
          previews.close({ threadId, tabId: tab.tabId }),
        ),
      { concurrency: 4 },
    );
    succeeded = browsersClosed.every(Boolean) && succeeded;
    if (rememberProcesses(threadId, yield* processes.list(threadId)).size > 0 && succeeded) {
      return yield* new ThreadCleanupError({
        threadId,
        detail: "Some chat processes are still running. Retry cleanup.",
      });
    }
    if (!succeeded) {
      yield* update(threadId, (state) => ({
        ...state,
        status: "failed",
        resources: state.resources.map((row) =>
          row.status === "closing"
            ? {
                ...row,
                status: "failed",
                error: "Waiting for the remaining cleanup. Retry to continue.",
              }
            : row,
        ),
      }));
      return;
    }
    const finalized = yield* attempt(
      threadId,
      { id: "chat", label: "Resolve chat", kind: "chat", status: "closing" },
      Effect.gen(function* () {
        yield* dispatchAndWait(
          automatic
            ? { type: "thread.auto-settle", commandId: yield* commandId, threadId, ...automatic }
            : { type: "thread.settle", commandId: yield* commandId, threadId },
        );
      }),
    );
    if (finalized) {
      pendingProcesses.delete(threadId);
      finishThreadCleanup(threadId);
    }
    yield* update(threadId, (state) => ({ ...state, status: finalized ? "complete" : "failed" }));
  });

  const start = Effect.fn("ThreadCleanup.start")(
    function* (
      input: ThreadCleanupInput,
      automatic?: Parameters<ThreadCleanup["Service"]["start"]>[1],
    ) {
      const previous = (yield* SubscriptionRef.get(states)).get(input.threadId);
      if (running.has(input.threadId) && previous?.status === "closing") return previous;
      let shell = yield* queries.getThreadShellById(input.threadId);
      if (Option.isNone(shell) || shell.value.archivedAt !== null)
        return yield* new ThreadCleanupError({
          threadId: input.threadId,
          detail: "Chat is missing or archived.",
        });
      if (
        !input.interruptAgent &&
        ["queued", "preparing", "starting", "running", "waiting"].includes(shell.value.status)
      ) {
        return yield* new ThreadCleanupError({
          threadId: input.threadId,
          detail: "Stop the working agent and resolve this chat?",
          confirmationRequired: true,
        });
      }
      const current = (yield* SubscriptionRef.get(states)).get(input.threadId);
      if (running.has(input.threadId) && current?.status === "closing") return current;
      // Verify the monitor before canceling a turn or locking launches. Inventory is
      // captured again under the cleanup lease so jobs started meanwhile are included.
      yield* processes.list(input.threadId);
      const afterPreflight = (yield* SubscriptionRef.get(states)).get(input.threadId);
      if (running.has(input.threadId) && afterPreflight?.status === "closing")
        return afterPreflight;
      const operationId = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
      shell = yield* queries.getThreadShellById(input.threadId);
      if (Option.isNone(shell) || shell.value.archivedAt !== null) {
        return yield* new ThreadCleanupError({
          threadId: input.threadId,
          detail: "Chat is missing or archived.",
        });
      }
      if (
        !input.interruptAgent &&
        ["queued", "preparing", "starting", "running", "waiting"].includes(shell.value.status)
      ) {
        return yield* new ThreadCleanupError({
          threadId: input.threadId,
          detail: "Stop the working agent and resolve this chat?",
          confirmationRequired: true,
        });
      }
      if (
        automatic &&
        (shell.value.settledOverride !== null ||
          DateTime.toEpochMillis(shell.value.updatedAt) >
            DateTime.toEpochMillis(automatic.snapshotAt) ||
          shell.value.activeRunId !== null ||
          shell.value.pendingRuntimeRequest !== null ||
          (shell.value.pendingBackgroundTasks?.length ?? 0) > 0)
      ) {
        return yield* new ThreadCleanupError({
          threadId: input.threadId,
          detail: "Chat changed or has live work. Automatic cleanup was skipped.",
        });
      }
      if (!beginThreadCleanup(input.threadId, automatic === undefined)) {
        return yield* new ThreadCleanupError({
          threadId: input.threadId,
          detail: "Chat has an active turn. Automatic cleanup was skipped.",
        });
      }
      running.set(input.threadId, operationId);
      const initial: ThreadCleanupSnapshot = {
        operationId,
        threadId: input.threadId,
        status: "closing",
        resources: [
          ...(previous?.status === "failed"
            ? previous.resources.filter((row) => row.status === "closed")
            : []),
          { id: "inventory", label: "Find chat resources", kind: "chat", status: "closing" },
        ],
      };
      yield* SubscriptionRef.update(states, (map) => new Map(map).set(input.threadId, initial));
      yield* withThreadResourceLease(input.threadId, run(input.threadId, automatic), true).pipe(
        Effect.catchCause((cause) =>
          update(input.threadId, (state) => ({
            ...state,
            status: "failed",
            resources: [
              ...state.resources
                .filter((row) => row.id !== "inventory")
                .map((row) =>
                  row.status === "closing"
                    ? {
                        ...row,
                        status: "failed" as const,
                        error: "Cleanup was interrupted. Retry to continue.",
                      }
                    : row,
                ),
              {
                id: "inventory",
                label: "Finish cleanup",
                kind: "chat",
                status: "failed",
                error:
                  Cause.squash(cause) instanceof Error
                    ? (Cause.squash(cause) as Error).message
                    : "Cleanup could not be verified. Retry to continue.",
              },
            ],
          })).pipe(
            Effect.andThen(
              Effect.logWarning("Chat cleanup failed", { threadId: input.threadId, cause }),
            ),
          ),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            if (running.get(input.threadId) === operationId) running.delete(input.threadId);
          }),
        ),
        Effect.interruptible,
        Effect.forkIn(scope),
      );
      return initial;
    },
    (effect, input) =>
      effect.pipe(
        Effect.uninterruptible,
        Effect.mapError((cause) =>
          isCleanupError(cause)
            ? cause
            : new ThreadCleanupError({ threadId: input.threadId, detail: cause.message }),
        ),
      ),
  );

  return ThreadCleanup.of({
    start,
    subscribe: (threadId) =>
      SubscriptionRef.changes(states).pipe(
        Stream.map((map) => map.get(threadId) ?? null),
        Stream.changes,
      ),
  });
});

export const layer = Layer.effect(ThreadCleanup, make);
