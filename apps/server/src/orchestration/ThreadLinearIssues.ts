import {
  CommandId,
  EventId,
  LinearIssueSetupError,
  type LinearIssueSetupInput,
  type LinearIssueSetupResult,
} from "@t3tools/contracts";
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Fiber from "effect/Fiber";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import { prepareLinearWorktree } from "../git/LinearWorktree.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as ProjectSetupScriptRunner from "../project/ProjectSetupScriptRunner.ts";
import * as TerminalManager from "../terminal/Manager.ts";

export class ThreadLinearIssues extends Context.Service<
  ThreadLinearIssues,
  {
    readonly select: (
      input: LinearIssueSetupInput,
    ) => Effect.Effect<LinearIssueSetupResult, LinearIssueSetupError>;
  }
>()("t3/orchestration/ThreadLinearIssues") {}

export const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const settings = yield* ServerSettingsService;
  const setup = yield* ProjectSetupScriptRunner.ProjectSetupScriptRunner;
  const terminals = yield* TerminalManager.TerminalManager;
  const scope = yield* Scope.Scope;
  const context =
    yield* Effect.context<Effect.Services<ReturnType<typeof prepareLinearWorktree>>>();
  const lock = yield* Semaphore.make(1);
  const select = Effect.fn("ThreadLinearIssues.select")(function* (input: LinearIssueSetupInput) {
    const snapshot = yield* snapshots.getShellSnapshot();
    const thread = snapshot.threads.find((item) => item.id === input.threadId);
    const project = snapshot.projects.find((item) => item.id === thread?.projectId);
    if (!thread || !project)
      return yield* new LinearIssueSetupError({
        detail: "The chat or project is no longer available.",
      });
    const configured = resolveProjectSettings(
      yield* settings.getSettings,
      project.id,
      project,
    ).settings;
    if (!configured.linearWorkspace || configured.linearWorkspace !== input.issue.workspace)
      return yield* new LinearIssueSetupError({
        detail: "The issue does not belong to this project's configured Linear workspace.",
      });
    if (thread.session?.status === "starting" || thread.session?.status === "running") {
      return yield* new LinearIssueSetupError({
        detail: "Wait for the agent in this chat to finish before switching issues.",
      });
    }
    const conflicts = snapshot.threads.filter(
      (other) =>
        other.id !== thread.id &&
        other.projectId === project.id &&
        other.archivedAt === null &&
        other.branch === input.issue.branchName &&
        other.settledOverride !== "settled",
    );
    const summary = conflicts.map((other) => ({
      threadId: other.id,
      projectId: other.projectId,
      title: other.title,
      running: other.session?.status === "starting" || other.session?.status === "running",
    }));
    if (
      summary.some((other) => other.running || !input.takeoverThreadIds.includes(other.threadId))
    ) {
      return {
        status: "conflict" as const,
        worktreePath: conflicts[0]?.worktreePath ?? project.workspaceRoot,
        conflicts: summary,
      };
    }
    const prepared = yield* prepareLinearWorktree({
      cwd: project.workspaceRoot,
      projectId: project.id,
      branchName: input.issue.branchName,
      baseRef: input.baseRef,
      submodules: configured.worktreeSubmodules,
    }).pipe(Effect.provide(context));
    const targetSnapshot = yield* snapshots.getShellSnapshot();
    const targetConflicts = targetSnapshot.threads.filter(
      (other) =>
        other.id !== thread.id &&
        other.archivedAt === null &&
        other.settledOverride !== "settled" &&
        (other.worktreePath === prepared.path ||
          (other.projectId === project.id && other.branch === input.issue.branchName)),
    );
    if (targetConflicts.some((other) => !input.takeoverThreadIds.includes(other.id))) {
      return {
        status: "conflict" as const,
        worktreePath: prepared.path,
        conflicts: targetConflicts.map((other) => ({
          threadId: other.id,
          projectId: other.projectId,
          title: other.title,
          running: other.session?.status === "starting" || other.session?.status === "running",
        })),
      };
    }
    const recordSetup = Effect.fnUntraced(function* (
      kind: "started" | "failed" | "completed" | "cancelled",
      payload: Record<string, unknown>,
    ) {
      const createdAt = DateTime.formatIso(yield* DateTime.now);
      yield* engine
        .dispatch({
          type: "thread.activity.append",
          commandId: CommandId.make(NodeCrypto.randomUUID()),
          threadId: thread.id,
          activity: {
            id: EventId.make(NodeCrypto.randomUUID()),
            kind: `setup-script.${kind}`,
            summary: `Setup script ${kind}`,
            tone: kind === "failed" ? "error" : "info",
            payload: { worktreePath: prepared.path, ...payload },
            turnId: null,
            createdAt,
          },
          createdAt,
        })
        .pipe(Effect.ignoreCause({ log: true }));
    });
    let completion: Fiber.Fiber<void> | undefined;
    let linked = false;
    return yield* Effect.gen(function* () {
      // Existing checkouts may contain a user's unfinished work. Only a checkout
      // created by this selection gets setup, with the same best-effort policy
      // and async flag as the ordinary first-turn bootstrap.
      if (prepared.created) {
        const waitForSetup = yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const result = yield* setup
              .runForThread({
                threadId: thread.id,
                projectId: project.id,
                projectCwd: project.workspaceRoot,
                worktreePath: prepared.path,
                preferredTerminalId: `setup-linear-${NodeCrypto.randomUUID()}`,
                observeCompletion: {},
              })
              .pipe(
                Effect.catch((error) =>
                  recordSetup("failed", { detail: error.message }).pipe(Effect.as(null)),
                ),
              );
            if (result?.status === "started" && result.completion) {
              const payload = {
                scriptId: result.scriptId,
                scriptName: result.scriptName,
                terminalId: result.terminalId,
              };
              // Consume the terminal subscription immediately, even if selection is
              // rejected later. Async installs outlive the request, but not the server.
              yield* recordSetup("started", payload);
              completion = yield* result.completion.pipe(
                Effect.flatMap(({ exitCode }) =>
                  recordSetup(exitCode === 0 ? "completed" : "failed", {
                    ...payload,
                    detail:
                      exitCode === null
                        ? "Terminal closed before setup finished."
                        : `Exit ${exitCode}`,
                  }),
                ),
                Effect.onInterrupt(() =>
                  terminals
                    .close({ threadId: thread.id, terminalId: result.terminalId })
                    .pipe(
                      Effect.ignoreCause({ log: true }),
                      Effect.andThen(recordSetup("cancelled", payload)),
                    ),
                ),
                Effect.interruptible,
                Effect.forkIn(scope, { startImmediately: true }),
              );
              return !result.async;
            }
            return false;
          }),
        );
        if (waitForSetup && completion) yield* Fiber.join(completion);
      }
      yield* engine.dispatch({
        type: "thread.linear-issue.select",
        commandId: input.commandId,
        threadId: input.threadId,
        issue: input.issue,
        worktreePath: prepared.path,
        expectedWorktreePath: input.expectedWorktreePath,
        expectedIssueId: input.expectedIssueId,
        takeoverThreadIds: input.takeoverThreadIds,
      });
      linked = true;
      return { status: "linked" as const, worktreePath: prepared.path, conflicts: [] };
    }).pipe(
      Effect.ensuring(
        Effect.suspend(() => (!linked && completion ? Fiber.interrupt(completion) : Effect.void)),
      ),
    );
  });
  return ThreadLinearIssues.of({
    select: (input) =>
      select(input).pipe(
        lock.withPermits(1),
        Effect.mapError((error) =>
          error._tag === "LinearIssueSetupError"
            ? error
            : new LinearIssueSetupError({ detail: error.message }),
        ),
      ),
  });
});
export const layer = Layer.effect(ThreadLinearIssues, make);
