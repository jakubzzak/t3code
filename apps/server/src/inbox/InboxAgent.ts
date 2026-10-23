import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  InboxError,
  MessageId,
  ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
  type InboxNotification,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings, resolveNewThreadEnvMode } from "@t3tools/shared/projectSettings";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as Projects from "../project/ProjectService.ts";
import * as ManagedFolders from "../project/ManagedProjectFolders.ts";
import * as ProjectFiles from "../project/T3ProjectFileLoader.ts";
import * as Git from "../git/GitWorkflowService.ts";
import * as ServerSettings from "../serverSettings.ts";

export class InboxAgent extends Context.Service<
  InboxAgent,
  {
    readonly start: (
      notification: InboxNotification,
      startAgent: boolean,
    ) => Effect.Effect<void, InboxError>;
    readonly stop: (threadId: ThreadId, commandId: CommandId) => Effect.Effect<void, InboxError>;
    readonly status: (
      threadId: ThreadId,
    ) => Effect.Effect<
      { running: boolean; settled: boolean; exists: boolean; error: string | null },
      InboxError
    >;
  }
>()("t3/inbox/InboxAgent") {}
const make = Effect.gen(function* () {
  const orchestrator = yield* ThreadManagement.ThreadManagementService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const projects = yield* Projects.ProjectService;
  const folders = yield* ManagedFolders.ManagedProjectFolders;
  const git = yield* Git.GitWorkflowService;
  const projectFiles = yield* ProjectFiles.T3ProjectFileLoader;
  const wrap = (cause: unknown) =>
    new InboxError({ detail: "Could not update the linked agent. Open the chat or retry.", cause });
  return InboxAgent.of({
    start: (notification, startAgent) =>
      Effect.gen(function* () {
        const threadId = notification.state.threadId!;
        const project = Option.getOrNull(yield* projects.getById(notification.projectId));
        if (!project)
          return yield* new InboxError({ detail: "This notification’s project no longer exists." });
        const resolved = resolveProjectSettings(
          yield* settings.getSettings,
          notification.projectId,
          project,
          Option.getOrNull(yield* projectFiles.load(project.workspaceRoot)),
        );
        const config = resolved.settings;
        if (startAgent && !config.inboxAgentEnabled)
          return yield* new InboxError({
            detail: "Enable Agent Delegation in this project’s Inbox settings.",
          });
        const modelSelection =
          config.inboxAgentModelSelection ??
          config.defaultModelSelection ??
          config.textGenerationModelSelection;
        const existing = yield* orchestrator.getThreadShell(threadId);
        const prompt = config.inboxAgentPrompt.trim()
          ? config.inboxAgentPrompt
          : DEFAULT_SERVER_SETTINGS.inboxAgentPrompt;
        // Replaying delivery must not create another turn. Preparation retries
        // reuse the durable run and workspace that the launch service owns.
        if (existing?.latestRunId) {
          if (!startAgent) return;
          const records = yield* orchestrator.getThreadRecords(threadId, ["runs"]);
          const run = records.runs.find((candidate) => candidate.id === existing.latestRunId);
          if (run?.status === "failed" && notification.agentAttempt > 0) {
            const failedPreparation =
              run.workspacePreparation &&
              (yield* orchestrator.getThreadProjection(threadId)).turnItems.some(
                (item) =>
                  item.runId === run.id &&
                  item.type === "error" &&
                  item.status === "failed" &&
                  item.failure.code === ORCHESTRATION_V2_WORKSPACE_PREPARATION_FAILURE_CODE,
              );
            if (failedPreparation)
              yield* launches.retryPreparation({
                commandId: CommandId.make(
                  `inbox:${notification.id}:retry:${notification.agentAttempt}`,
                ),
                threadId,
                runId: run.id,
              });
            else
              yield* orchestrator.dispatch({
                type: "message.dispatch",
                commandId: CommandId.make(
                  `inbox:${notification.id}:start:${notification.agentAttempt}`,
                ),
                threadId,
                messageId: MessageId.make(
                  `inbox:${notification.id}:message:${notification.agentAttempt}`,
                ),
                text: prompt,
                attachments: [],
                modelSelection,
                createdBy: "user",
                creationSource: "web",
                dispatchMode: { type: "start_immediately" },
              });
          }
          return;
        }
        const siblings = yield* orchestrator.listProjectThreads({
          projectId: project.id,
          includeSubagents: true,
        });
        const mode = resolveNewThreadEnvMode({
          projectSettings: resolved,
          workspaceRoot: project.workspaceRoot,
          newProjectsRoot: folders.namedProjectsRoot,
          projectHasThreads: siblings.some((thread) => thread.id !== threadId),
        });
        let workspaceStrategy: ThreadLaunch.ThreadLaunchWorkspaceStrategy = existing?.worktreePath
          ? {
              type: "existing_worktree",
              worktreePath: existing.worktreePath,
              ...(existing.branch ? { branch: existing.branch } : {}),
            }
          : { type: "root" };
        if (!existing?.worktreePath && mode === "worktree") {
          const status = yield* git.localStatus({ cwd: project.workspaceRoot });
          if (status.isRepo)
            workspaceStrategy = {
              type: "worktree",
              baseRef: status.refName ?? "HEAD",
              startFromOrigin: status.refName !== null && config.newWorktreesStartFromOrigin,
            };
        }
        if (!existing)
          yield* orchestrator.dispatch({
            type: "thread.create",
            commandId: CommandId.make(`inbox:${notification.id}:create:${notification.revision}`),
            threadId,
            projectId: notification.projectId,
            title: notification.items.at(-1)?.title || "Notification",
            modelSelection,
            runtimeMode: config.defaultRuntimeMode,
            interactionMode: "default",
            branch: null,
            worktreePath: null,
            createdBy: "user",
            creationSource: "web",
          });
        yield* launches.launch({
          commandId: CommandId.make(
            `inbox:${notification.id}:launch:${startAgent ? "run" : "chat"}:${notification.agentAttempt}`,
          ),
          threadId,
          reuseExistingThread: true,
          projectId: project.id,
          title: notification.items.at(-1)?.title || "Notification",
          modelSelection,
          runtimeMode: config.defaultRuntimeMode,
          interactionMode: "default",
          workspaceStrategy,
          createdBy: "user",
          creationSource: "web",
          ...(startAgent
            ? {
                initialMessage: {
                  messageId: MessageId.make(
                    `inbox:${notification.id}:message:${notification.agentAttempt}`,
                  ),
                  text: prompt,
                  attachments: [],
                },
              }
            : {}),
        });
      }).pipe(Effect.mapError(wrap)),
    stop: (threadId, commandId) =>
      Effect.gen(function* () {
        const shell = yield* orchestrator.getThreadShell(threadId);
        if (shell?.latestRunId)
          yield* orchestrator.dispatch({
            type: "run.interrupt",
            threadId,
            commandId,
            runId: shell.latestRunId,
            reason: "Notification delegation undone",
            holdQueue: true,
          });
      }).pipe(Effect.mapError(wrap)),
    status: (threadId) =>
      orchestrator.getThreadShell(threadId).pipe(
        Effect.map((shell) => ({
          exists: shell !== null,
          running: shell?.activeRunId != null,
          settled: shell?.settledAt != null,
          error:
            shell?.status === "failed"
              ? (shell.lastError ?? "The linked agent failed. Open the chat or retry.")
              : null,
        })),
        Effect.mapError(wrap),
      ),
  });
});
export const layer = Layer.effect(InboxAgent, make);
