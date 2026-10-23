import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
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
  type InboxSlackThread,
  ProjectId,
  ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as ServerSettings from "../serverSettings.ts";
import * as InboxRepository from "./InboxRepository.ts";
import * as InboxAnalysis from "./InboxAnalysis.ts";
import * as InboxAgent from "./InboxAgent.ts";
import { readableInboxItem, readableNotification } from "./notificationContent.ts";
import {
  inboxIdentity,
  ingestInboxItem,
  restoreInboxState,
  mergeSlackThread,
} from "./inboxState.ts";

export class InboxService extends Context.Service<
  InboxService,
  {
    readonly list: (input: {
      projectId: ProjectId;
      search?: string;
      offset?: number;
      limit?: number;
      threadId?: ThreadId;
    }) => Effect.Effect<ReadonlyArray<InboxNotification>, InboxError>;
    readonly get: (input: {
      projectId: ProjectId;
      id: string;
    }) => Effect.Effect<InboxNotification | null, InboxError>;
    readonly cacheSlackThread: (input: {
      projectId: ProjectId;
      id: string;
      thread: InboxSlackThread;
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
  const analysisDrainPermit = yield* Semaphore.make(1);
  const settings = yield* ServerSettings.ServerSettingsService;
  const mutex = yield* Semaphore.make(1);
  const scope = yield* Effect.scope;
  const readProjectSettings = (projectId: ProjectId) =>
    settings.getSettings.pipe(
      Effect.mapError(
        (cause) => new InboxError({ detail: "Could not read project settings.", cause }),
      ),
      Effect.map((value) => resolveProjectSettings(value, projectId).settings),
    );
  const requireEnabled = (projectId: ProjectId) =>
    readProjectSettings(projectId).pipe(
      Effect.flatMap((value) =>
        value.inboxEnabled
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
      let next = readableNotification(item);
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
              if (action.startAgent) {
                const config = yield* readProjectSettings(input.projectId);
                if (!config.inboxAgentEnabled)
                  return yield* new InboxError({
                    detail: "Enable Agent Delegation in this project’s Inbox settings.",
                  });
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
              if (!(yield* readProjectSettings(input.projectId)).inboxSummaryEnabled)
                return yield* new InboxError({
                  detail: "Enable Summary in this project’s Inbox settings.",
                });
              next = {
                ...current,
                analysis: null,
                processingError: null,
                analysisAttempts: 0,
                analysisRetryAt: null,
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
  const analyzing = new Map<string, Deferred.Deferred<void>>();
  const analyze = (notification: InboxNotification): Effect.Effect<void> =>
    Effect.suspend(() => {
      const inFlight = analyzing.get(notification.id);
      if (inFlight) return Deferred.await(inFlight).pipe(Effect.andThen(analyze(notification)));
      const done = Deferred.makeUnsafe<void>();
      analyzing.set(notification.id, done);
      return Effect.gen(function* () {
        const projectSettings = yield* readProjectSettings(notification.projectId);
        if (!projectSettings.inboxEnabled || !projectSettings.inboxSummaryEnabled) return;
        const claimed = yield* mutex.withPermits(1)(
          Effect.gen(function* () {
            const stored = yield* repository.get(notification.projectId, notification.id);
            if (!stored || stored.analysisVersion !== notification.analysisVersion) return null;
            const current = readableNotification(stored);
            const now = yield* Clock.currentTimeMillis;
            if (
              current.analysis ||
              current.processingError ||
              (current.analysisRetryAt && Date.parse(current.analysisRetryAt) > now)
            )
              return null;
            if ((current.analysisAttempts ?? 0) >= 3) {
              yield* save({
                ...current,
                processingError: "AI summary not available",
                analysisRetryAt: null,
              });
              return null;
            }
            // Persist a bounded lease before starting a call, so a restart cannot reset the budget.
            const next = {
              ...current,
              analysisAttempts: (current.analysisAttempts ?? 0) + 1,
              analysisRetryAt: DateTime.formatIso(DateTime.makeUnsafe(now + 60_000)),
            };
            yield* save(next);
            return next;
          }),
        );
        if (!claimed) return;
        const history = projectSettings.inboxMemoryEnabled
          ? yield* repository.history(notification.projectId)
          : [];
        const analyzed = yield* analyzer.analyze(claimed, history).pipe(
          Effect.timeout("1 minute"),
          Effect.flatMap((result) =>
            result.summary.trim()
              ? Effect.succeed(result)
              : Effect.fail(new InboxError({ detail: "Empty summary" })),
          ),
          Effect.result,
        );
        const delay = yield* mutex.withPermits(1)(
          Effect.gen(function* () {
            const current = yield* repository.get(notification.projectId, notification.id);
            if (
              !current ||
              current.analysisVersion !== claimed.analysisVersion ||
              current.analysisAttempts !== claimed.analysisAttempts
            )
              return null;
            const exhausted = claimed.analysisAttempts >= 3;
            const retryDelay = claimed.analysisAttempts * 5_000;
            yield* save({
              ...current,
              analysis: analyzed._tag === "Success" ? analyzed.success : null,
              processingError:
                analyzed._tag === "Failure" && exhausted ? "AI summary not available" : null,
              analysisRetryAt:
                analyzed._tag === "Failure" && !exhausted
                  ? DateTime.formatIso(
                      DateTime.makeUnsafe((yield* Clock.currentTimeMillis) + retryDelay),
                    )
                  : null,
            });
            return analyzed._tag === "Failure" && !exhausted ? retryDelay : null;
          }),
        );
        if (delay !== null)
          yield* Effect.sleep(delay).pipe(Effect.andThen(analyze(claimed)), Effect.forkIn(scope));
      }).pipe(
        analysisPermits.withPermits(1),
        Effect.catch((error) =>
          Effect.logWarning("Inbox analysis failed", { detail: error.detail }),
        ),
        Effect.ensuring(
          Effect.sync(() => {
            analyzing.delete(notification.id);
          }).pipe(Effect.andThen(Deferred.succeed(done, undefined))),
        ),
      );
    });
  const drainAnalysis = analysisDrainPermit.withPermits(1)(
    Effect.gen(function* () {
      const config = yield* settings.getSettings.pipe(
        Effect.mapError(
          (cause) => new InboxError({ detail: "Could not read project settings.", cause }),
        ),
      );
      const projects = Object.keys(config.projectSettingsOverrides)
        .map((id) => ProjectId.make(id))
        .filter((id) => {
          const project = resolveProjectSettings(config, id).settings;
          return project.inboxEnabled && project.inboxSummaryEnabled;
        });
      const notifications = yield* repository.pendingAnalysis(projects);
      yield* Effect.forEach(notifications, analyze, { concurrency: 2, discard: true });
      // An explicit drain also waits for already claimed work, without waiting on future retries.
      yield* Effect.forEach([...analyzing.values()], (done) => Deferred.await(done), {
        discard: true,
      });
    }),
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
          const config = yield* readProjectSettings(input.projectId);
          const items = yield* repository.list(input.projectId, {
            ...input,
            summaryReady: config.inboxSummaryEnabled,
          });
          const result: InboxNotification[] = [];
          for (const item of items) {
            const next = yield* reconcile(item);
            if (config.inboxSummaryEnabled && !next.analysis && !next.processingError) continue;
            // List responses are bounded previews. Expanded rows fetch their full detail separately.
            const { slackThread: _thread, ...preview } = next;
            result.push({
              ...preview,
              items: next.items
                .slice(-1)
                .map(({ formattedContent: _formattedContent, slackThread: _thread, ...entry }) => ({
                  ...entry,
                  content: entry.content.slice(0, 320),
                })),
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
      mutex.withPermits(1)(
        requireEnabled(input.projectId).pipe(
          Effect.andThen(repository.get(input.projectId, input.id)),
          Effect.flatMap((item) => (item ? reconcile(item) : Effect.succeed(null))),
        ),
      ),
    cacheSlackThread: (input) =>
      mutex.withPermits(1)(
        Effect.gen(function* () {
          yield* requireEnabled(input.projectId);
          const current = yield* repository.get(input.projectId, input.id);
          if (!current || current.source !== "slack") return null;
          const key = `${input.thread.channelId}:${input.thread.ts}`;
          if (current.groupId !== key)
            return yield* Effect.fail(
              new InboxError({ detail: "This thread does not belong to this notification." }),
            );
          // Hydration/history does not mark unread, clear analysis, or change triage state.
          if (
            current.slackThread?.latestReplyTs &&
            input.thread.latestReplyTs &&
            Number(current.slackThread.latestReplyTs) > Number(input.thread.latestReplyTs)
          )
            return current;
          const next = {
            ...current,
            slackThread: mergeSlackThread(current.slackThread, input.thread),
          };
          yield* repository.put(next);
          return next;
        }),
      ),
    ingest: (projectId, items) =>
      mutex
        .withPermits(1)(
          Effect.gen(function* () {
            yield* requireEnabled(projectId);
            for (const raw of items) {
              const item = readableInboxItem(raw);
              const stored = yield* repository.get(projectId, inboxIdentity(projectId, item));
              const previous = stored ? readableNotification(stored) : undefined;
              const next = ingestInboxItem(projectId, item, previous);
              if (stored !== next) {
                yield* repository.put(
                  stored && next.revision === stored.revision
                    ? { ...next, revision: next.revision + 1 }
                    : next,
                );
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
