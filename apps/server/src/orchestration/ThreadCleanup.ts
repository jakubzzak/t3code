import {
  CommandId,
  ThreadCleanupError,
  type ThreadCleanupInput,
  type ThreadCleanupResource,
  type ThreadCleanupSnapshot,
  type ThreadId,
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
import * as PreviewAutomationBroker from "../mcp/PreviewAutomationBroker.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import * as ThreadProcesses from "../process/ThreadProcesses.ts";
import {
  beginThreadCleanup,
  finishThreadCleanup,
  withThreadResourceLease,
} from "../process/threadResourceLease.ts";
import * as OrchestrationEngine from "./Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./Services/ProjectionSnapshotQuery.ts";

export class ThreadCleanup extends Context.Service<
  ThreadCleanup,
  {
    readonly start: (
      input: ThreadCleanupInput,
    ) => Effect.Effect<ThreadCleanupSnapshot, ThreadCleanupError>;
    readonly subscribe: (threadId: ThreadId) => Stream.Stream<ThreadCleanupSnapshot | null>;
  }
>()("t3/orchestration/ThreadCleanup") {}

const isCleanupError = Schema.is(ThreadCleanupError);

const make = Effect.gen(function* () {
  const scope = yield* Scope.Scope;
  const crypto = yield* Crypto.Crypto;
  const terminals = yield* TerminalManager.TerminalManager;
  const previews = yield* PreviewManager.PreviewManager;
  const browser = yield* PreviewAutomationBroker.PreviewAutomationBroker;
  const providers = yield* ProviderService;
  const processes = yield* ThreadProcesses.ThreadProcesses;
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const queries = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const states = yield* SubscriptionRef.make(new Map<ThreadId, ThreadCleanupSnapshot>());
  const running = new Map<ThreadId, string>();

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
        onSuccess: () => resource(threadId, { ...row, status: "closed" }).pipe(Effect.as(true)),
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
  const commandId = crypto.randomUUIDv4.pipe(Effect.map((id) => CommandId.make(`cleanup:${id}`)));

  const run = Effect.fn("ThreadCleanup.run")(function* (threadId: ThreadId) {
    const shell = yield* queries.getThreadShellById(threadId);
    if (Option.isNone(shell))
      return yield* new ThreadCleanupError({ threadId, detail: "Chat no longer exists." });
    const thread = shell.value;
    const terminalList = yield* terminals.listForThread(threadId);
    const owned = yield* processes.list(
      threadId,
      terminalList.flatMap((terminal) => (terminal.pid === null ? [] : [terminal.pid])),
    );
    const previewList = yield* previews.list({ threadId });
    const rows: ThreadCleanupResource[] = [
      ...(thread.session && thread.session.status !== "stopped"
        ? [
            {
              id: "agent",
              label: `${thread.session.providerName ?? "Agent"} session`,
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
    if (thread.session && thread.session.status !== "stopped") {
      succeeded = yield* attempt(
        threadId,
        rows.find((row) => row.id === "agent")!,
        providers.stopSession({ threadId }).pipe(Effect.timeout("3 seconds")),
      );
    }
    // Scan again after stopping the agent to include jobs launched during teardown.
    const remaining = yield* processes.list(threadId);
    const targets = [
      ...new Map(
        [...owned, ...remaining].map((entry) => [`${entry.pid}:${entry.startTimeMs}`, entry]),
      ).values(),
    ];
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
          processes.stop(threadId, entry),
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
          browser
            .closeTab(threadId, tab.tabId)
            .pipe(Effect.andThen(previews.close({ threadId, tabId: tab.tabId }))),
        ),
      { concurrency: 4 },
    );
    succeeded = browsersClosed.every(Boolean) && succeeded;
    if ((yield* processes.list(threadId)).length > 0) {
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
        const now = DateTime.formatIso(yield* DateTime.now);
        if (thread.session) {
          yield* engine.dispatch({
            type: "thread.session.set",
            commandId: yield* commandId,
            threadId,
            session: { ...thread.session, status: "stopped", activeTurnId: null, updatedAt: now },
            createdAt: now,
          });
        }
        yield* engine.dispatch({
          type: "thread.cleanup.complete",
          commandId: yield* commandId,
          threadId,
        });
      }),
    );
    if (finalized) finishThreadCleanup(threadId);
    yield* update(threadId, (state) => ({ ...state, status: finalized ? "complete" : "failed" }));
  });

  const start = Effect.fn("ThreadCleanup.start")(
    function* (input: ThreadCleanupInput) {
      const previous = (yield* SubscriptionRef.get(states)).get(input.threadId);
      if (running.has(input.threadId) && previous?.status === "closing") return previous;
      const shell = yield* queries.getThreadShellById(input.threadId);
      if (Option.isNone(shell) || shell.value.archivedAt !== null)
        return yield* new ThreadCleanupError({
          threadId: input.threadId,
          detail: "Chat is missing or archived.",
        });
      if (
        !input.interruptAgent &&
        (shell.value.session?.status === "running" || shell.value.session?.status === "starting")
      ) {
        return yield* new ThreadCleanupError({
          threadId: input.threadId,
          detail: "Stop the working agent and resolve this chat?",
          confirmationRequired: true,
        });
      }
      const current = (yield* SubscriptionRef.get(states)).get(input.threadId);
      if (running.has(input.threadId) && current?.status === "closing") return current;
      const operationId = yield* crypto.randomUUIDv4;
      running.set(input.threadId, operationId);
      beginThreadCleanup(input.threadId);
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
      yield* withThreadResourceLease(input.threadId, run(input.threadId), true).pipe(
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
