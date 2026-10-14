import {
  LinearIssueSetupError,
  type LinearIssueSetupInput,
  type LinearIssueSetupResult,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import { prepareLinearWorktree } from "../git/LinearWorktree.ts";
import { OrchestrationEngineService } from "./Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "./Services/ProjectionSnapshotQuery.ts";
import { ServerSettingsService } from "../serverSettings.ts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";

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
    const configured = resolveProjectSettings(yield* settings.getSettings, project.id).settings
      .linearWorkspace;
    if (!configured || configured !== input.issue.workspace)
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
    return { status: "linked" as const, worktreePath: prepared.path, conflicts: [] };
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
