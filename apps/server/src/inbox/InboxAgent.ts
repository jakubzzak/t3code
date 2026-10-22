import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  CommandId,
  DEFAULT_SERVER_SETTINGS,
  InboxError,
  MessageId,
  type InboxNotification,
  type ThreadId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
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
  const wrap = (cause: unknown) =>
    new InboxError({ detail: "Could not update the linked agent. Open the chat or retry.", cause });
  return InboxAgent.of({
    start: (notification, startAgent) =>
      Effect.gen(function* () {
        const threadId = notification.state.threadId!;
        const config = resolveProjectSettings(
          yield* settings.getSettings,
          notification.projectId,
        ).settings;
        const modelSelection =
          config.inboxAgentModelSelection ??
          config.defaultModelSelection ??
          config.textGenerationModelSelection;
        const existing = yield* orchestrator.getThreadShell(threadId);
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
        if (startAgent)
          yield* orchestrator.dispatch({
            type: "message.dispatch",
            commandId: CommandId.make(
              `inbox:${notification.id}:start:${notification.agentAttempt}`,
            ),
            threadId,
            messageId: MessageId.make(
              `inbox:${notification.id}:message:${notification.agentAttempt}`,
            ),
            text:
              config.inboxAgentPromptEnabled && config.inboxAgentPrompt.trim()
                ? config.inboxAgentPrompt
                : DEFAULT_SERVER_SETTINGS.inboxAgentPrompt,
            attachments: [],
            modelSelection,
            createdBy: "user",
            creationSource: "web",
            dispatchMode: { type: "start_immediately" },
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
