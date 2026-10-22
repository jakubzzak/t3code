import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import {
  CommandId,
  InboxError,
  InboxMutation,
  type InboxMutateInput,
  type InboxMutationResult,
  type InboxNotification,
  type InboxSourceItem,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as ServerSettings from "../serverSettings.ts";
import * as InboxRepository from "./InboxRepository.ts";
import * as InboxAnalysis from "./InboxAnalysis.ts";
import * as InboxAgent from "./InboxAgent.ts";
import { inboxIdentity, ingestInboxItem, restoreInboxState } from "./inboxState.ts";

export class InboxService extends Context.Service<
  InboxService,
  {
    readonly list: (input: {
      projectId: ProjectId;
      search?: string;
      offset?: number;
      threadId?: ThreadId;
    }) => Effect.Effect<ReadonlyArray<InboxNotification>, InboxError>;
    readonly get: (input: {
      projectId: ProjectId;
      id: string;
    }) => Effect.Effect<InboxNotification | null, InboxError>;
    readonly ingest: (
      projectId: ProjectId,
      items: ReadonlyArray<InboxSourceItem>,
    ) => Effect.Effect<void, InboxError>;
    readonly mutate: <E = never, R = never>(
      input: InboxMutateInput,
      check?: Effect.Effect<void, E, R>,
    ) => Effect.Effect<InboxMutationResult, InboxError | E, R>;
    /** Durable pending work is also drained explicitly by tests, without timers. */
    readonly drain: Effect.Effect<void, InboxError>;
    readonly drainAnalysis: Effect.Effect<void, InboxError>;
  }
>()("t3/inbox/InboxService") {}
const make = Effect.gen(function* () {
  const repository = yield* InboxRepository.InboxRepository;
  const agent = yield* InboxAgent.InboxAgent;
  const analyzer = yield* InboxAnalysis.InboxAnalysis;
  const analysisPermits = yield* Semaphore.make(2);
  const settings = yield* ServerSettings.ServerSettingsService;
  const mutex = yield* Semaphore.make(1);
  const scope = yield* Effect.scope;
  const requireEnabled = (projectId: ProjectId) =>
    settings.getSettings.pipe(
      Effect.mapError(
        (cause) => new InboxError({ detail: "Could not read project settings.", cause }),
      ),
      Effect.flatMap((value) =>
        resolveProjectSettings(value, projectId).settings.inboxEnabled
          ? Effect.void
          : Effect.fail(
              new InboxError({ detail: "Enable Inbox for this project in Settings → Features." }),
            ),
      ),
    );
  const save = (notification: InboxNotification) =>
    repository.put({ ...notification, revision: notification.revision + 1 });
  const reconcile = (item: InboxNotification) =>
    Effect.gen(function* () {
      let next = item;
      if (
        item.state.placement === "snoozed" &&
        item.state.snoozedUntil !== null &&
        Date.parse(item.state.snoozedUntil) <= (yield* Clock.currentTimeMillis)
      ) {
        next = {
          ...next,
          state: {
            ...next.state,
            placement: next.state.threadId ? "delegated" : "active",
            snoozedUntil: null,
          },
        };
      }
      if (next.state.threadId && !["linking", "starting", "failed"].includes(next.agentStatus)) {
        const status = yield* agent.status(next.state.threadId);
        if (status.exists) {
          if (next.agentStatus === "running" && status.error)
            next = { ...next, agentStatus: "failed", agentError: status.error };
          else if (next.agentStatus === "stop-requested" && !status.running)
            next = { ...next, agentStatus: "stopped" };
          else if (next.agentStatus === "running" && !status.running)
            next = { ...next, agentStatus: "stopped" };
          if (status.settled !== next.linkedChatSettled)
            next = {
              ...next,
              linkedChatSettled: status.settled,
              state: {
                ...next.state,
                placement: status.settled ? "resolved" : "delegated",
                snoozedUntil: null,
              },
            };
        }
      }
      if (next !== item) {
        next = { ...next, revision: item.revision + 1 };
        yield* repository.put(next);
      }
      return next;
    });
  const drain = mutex.withPermits(1)(
    Effect.gen(function* () {
      for (const item of yield* repository.pending) {
        if (item.agentStatus === "stop-requested") {
          const status = yield* agent.status(item.state.threadId!);
          if (status.exists && !status.running) {
            yield* save({ ...item, agentStatus: "stopped", agentError: null });
            continue;
          }
        } else {
          const enabled = resolveProjectSettings(
            yield* settings.getSettings.pipe(
              Effect.mapError(
                (cause) => new InboxError({ detail: "Could not read project settings.", cause }),
              ),
            ),
            item.projectId,
          ).settings.inboxEnabled;
          if (!enabled) continue;
        }
        const work =
          item.agentStatus === "stop-requested"
            ? agent
                .start(item, false)
                .pipe(
                  Effect.andThen(
                    agent.stop(
                      item.state.threadId!,
                      CommandId.make(`inbox:${item.id}:stop:${item.revision}`),
                    ),
                  ),
                )
            : agent.start(item, item.agentStatus === "starting");
        yield* work.pipe(
          Effect.flatMap(() =>
            save({
              ...item,
              agentStatus:
                item.agentStatus === "starting"
                  ? "running"
                  : item.agentStatus === "stop-requested"
                    ? "stop-requested"
                    : "idle",
              agentError: null,
            }),
          ),
          Effect.catch((error) =>
            save({ ...item, agentStatus: "failed", agentError: error.detail }),
          ),
        );
      }
    }),
  );
  const kick = drain.pipe(
    Effect.catch((error) => Effect.logWarning("Inbox work failed", { detail: error.detail })),
    Effect.forkIn(scope),
    Effect.asVoid,
  );
  const mutate: InboxService["Service"]["mutate"] = (input, check = Effect.void) =>
    mutex
      .withPermits(1)(
        Effect.gen(function* () {
          yield* check;
          yield* requireEnabled(input.projectId);
          const replay = yield* repository.receipt(input.commandId);
          if (replay) {
            if (replay.projectId !== input.projectId || replay.notificationId !== input.id)
              return yield* new InboxError({
                detail: "This command belongs to another notification.",
              });
            if (replay.action && !Schema.toEquivalence(InboxMutation)(replay.action, input.action))
              return yield* new InboxError({
                detail: "This command ID was already used for another action.",
              });
            return replay.result;
          }
          const current = yield* repository.get(input.projectId, input.id);
          if (!current)
            return yield* new InboxError({ detail: "Notification not found in this project." });
          if (current.revision !== input.expectedRevision)
            return yield* new InboxError({
              detail: "This notification changed on another client. Refresh and try again.",
            });
          let next = current;
          let openThread = false;
          let undone: CommandId | undefined;
          let undoable = true;
          const action = input.action;
          switch (action.type) {
            case "read":
              next = { ...current, state: { ...current.state, read: action.read } };
              break;
            case "snooze":
              if (action.until && Date.parse(action.until) <= (yield* Clock.currentTimeMillis))
                return yield* new InboxError({ detail: "Choose a future snooze time." });
              next = {
                ...current,
                state: {
                  ...current.state,
                  snoozedUntil: action.until,
                  placement: action.until
                    ? "snoozed"
                    : current.state.threadId
                      ? "delegated"
                      : "active",
                },
              };
              break;
            case "resolve":
              next = {
                ...current,
                state: {
                  ...current.state,
                  placement: action.resolved
                    ? "resolved"
                    : current.state.threadId
                      ? "delegated"
                      : "active",
                  snoozedUntil: null,
                },
              };
              break;
            case "delegate":
              if (current.state.threadId) {
                openThread = true;
                undoable = false;
                break;
              }
              next = {
                ...current,
                state: {
                  ...current.state,
                  placement: "delegated",
                  snoozedUntil: null,
                  threadId: ThreadId.make(`inbox:${current.id}`),
                },
                agentStatus: action.startAgent ? "starting" : "linking",
                agentIntent: action.startAgent ? "run" : "chat",
                agentError: null,
              };
              openThread = !action.startAgent;
              break;
            case "undo": {
              const receipt = yield* repository.receipt(action.commandId);
              if (
                !receipt ||
                receipt.undone ||
                receipt.projectId !== input.projectId ||
                receipt.notificationId !== input.id ||
                !receipt.result.undoCommandId
              )
                return yield* new InboxError({ detail: "This action cannot be undone." });
              // The retained link is the only field Undo intentionally does not restore.
              if (
                current.state.read !== receipt.after.read ||
                current.state.placement !== receipt.after.placement ||
                current.state.snoozedUntil !== receipt.after.snoozedUntil
              )
                return yield* new InboxError({
                  detail: "A later action changed this notification. Undo that action first.",
                });
              next = restoreInboxState(current, receipt.before);
              undone = action.commandId;
              undoable = false;
              break;
            }
            case "retry":
              if (current.agentStatus !== "failed" || !current.state.threadId)
                return yield* new InboxError({
                  detail: "There is no failed agent operation to retry.",
                });
              next = {
                ...current,
                agentAttempt: current.agentAttempt + 1,
                agentStatus:
                  current.agentIntent === "stop"
                    ? "stop-requested"
                    : current.agentIntent === "chat"
                      ? "linking"
                      : "starting",
                agentError: null,
              };
              undoable = false;
              break;
            case "reprocess":
              next = {
                ...current,
                analysis: null,
                processingError: null,
                analysisVersion: current.analysisVersion + 1,
              };
              undoable = false;
              break;
            case "outcome":
              next = { ...current, confirmedOutcome: action.text.trim() || null };
              undoable = false;
              break;
          }
          next = { ...next, revision: current.revision + 1 };
          const result = {
            notification: next,
            openThread,
            undoCommandId: undoable ? input.commandId : null,
          };
          yield* repository.commit(
            next,
            {
              commandId: input.commandId,
              projectId: input.projectId,
              notificationId: input.id,
              action: input.action,
              before: current.state,
              after: next.state,
              result,
              undone: false,
            },
            undone,
          );
          return result;
        }),
      )
      .pipe(
        Effect.tap(() => kick),
        Effect.tap(() => kickAnalysis),
      );
  const analyze = (notification: InboxNotification) =>
    Effect.gen(function* () {
      const config = yield* settings.getSettings.pipe(
        Effect.mapError(
          (cause) => new InboxError({ detail: "Could not read project settings.", cause }),
        ),
      );
      if (!resolveProjectSettings(config, notification.projectId).settings.inboxEnabled) return;
      const history = yield* repository.history(notification.projectId);
      const analyzed = yield* analyzer.analyze(notification, history).pipe(Effect.result);
      yield* mutex.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* repository.get(notification.projectId, notification.id);
          if (
            !current ||
            current.analysisVersion !== notification.analysisVersion ||
            current.updatedAt !== notification.updatedAt ||
            current.items.length !== notification.items.length ||
            current.items.some((item, index) => item.content !== notification.items[index]?.content)
          )
            return;
          yield* save({
            ...current,
            analysis: analyzed._tag === "Success" ? analyzed.success : null,
            processingError: analyzed._tag === "Failure" ? analyzed.failure.detail : null,
          });
        }),
      );
    }).pipe(
      analysisPermits.withPermits(1),
      Effect.catch((error) => Effect.logWarning("Inbox analysis failed", { detail: error.detail })),
    );
  const analyzing = new Set<string>();
  const drainAnalysis = repository.pendingAnalysis.pipe(
    Effect.flatMap((notifications) =>
      Effect.forEach(
        notifications,
        (notification) =>
          Effect.suspend(() => {
            if (analyzing.has(notification.id)) return Effect.void;
            analyzing.add(notification.id);
            return analyze(notification).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  analyzing.delete(notification.id);
                }),
              ),
            );
          }),
        { concurrency: 2, discard: true },
      ),
    ),
  );
  const kickAnalysis = drainAnalysis.pipe(
    Effect.catch((error) =>
      Effect.logWarning("Inbox analysis queue failed", { detail: error.detail }),
    ),
    Effect.forkIn(scope),
    Effect.asVoid,
  );
  yield* Effect.all([drain, drainAnalysis], { concurrency: 2 }).pipe(
    Effect.catch((error) => Effect.logWarning("Inbox recovery failed", { detail: error.detail })),
    Effect.repeat(Schedule.spaced("30 seconds")),
    Effect.forkIn(scope),
  );
  return InboxService.of({
    list: (input) =>
      mutex.withPermits(1)(
        Effect.gen(function* () {
          yield* requireEnabled(input.projectId);
          const items = yield* repository.list(input.projectId, input);
          const result: InboxNotification[] = [];
          for (const item of items) {
            const next = yield* reconcile(item);
            // List responses are bounded previews. Expanded rows fetch their full detail separately.
            result.push({
              ...next,
              items: next.items
                .slice(-1)
                .map((entry) => ({ ...entry, content: entry.content.slice(0, 320) })),
              analysis: next.analysis
                ? {
                    ...next.analysis,
                    summary:
                      next.analysis.summary.length > 600
                        ? `${next.analysis.summary.slice(0, 600)}…`
                        : next.analysis.summary,
                    suggestions: [],
                  }
                : null,
            });
          }
          return result;
        }),
      ),
    get: (input) =>
      requireEnabled(input.projectId).pipe(
        Effect.andThen(repository.get(input.projectId, input.id)),
      ),
    ingest: (projectId, items) =>
      mutex
        .withPermits(1)(
          Effect.gen(function* () {
            yield* requireEnabled(projectId);
            for (const item of items) {
              const previous = yield* repository.get(projectId, inboxIdentity(projectId, item));
              const next = ingestInboxItem(projectId, item, previous ?? undefined);
              if (previous !== next) {
                yield* repository.put(next);
              }
            }
          }),
        )
        .pipe(Effect.tap(() => kickAnalysis)),
    mutate,
    drain,
    drainAnalysis,
  });
});
export const layer = Layer.effect(InboxService, make);
