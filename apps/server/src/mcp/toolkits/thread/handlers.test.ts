import { expect, it } from "@effect/vitest";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as ThreadSearch from "../../../orchestration-v2/ThreadSearch.ts";
import * as ScheduledTasks from "../../../scheduledTasks/ScheduledTaskService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import * as ThreadHandlers from "./handlers.ts";
import { ThreadToolkit } from "./tools.ts";

it.effect(
  "supports explicit environment search while preserving default and explicit project scope",
  () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("scratch");
      const threadId = ThreadId.make("caller");
      const providerInstanceId = ProviderInstanceId.make("codex");
      const received: Array<Parameters<ThreadSearch.ThreadSearch["Service"]["search"]>[0]> = [];
      const dependencies = Layer.mergeAll(
        NodeCrypto.layer,
        Layer.succeed(McpInvocationContext.McpInvocationContext, {
          environmentId: EnvironmentId.make("test"),
          requestNamespace: "session",
          thread: { threadId, providerSessionId: "session", providerInstanceId },
          client: undefined,
          issuedAt: 0,
          capabilities: new Set(["orchestration" as const]),
        }),
        Layer.mock(ThreadManagement.ThreadManagementService)({
          getThreadShell: () =>
            Effect.succeed({
              id: threadId,
              projectId,
              providerInstanceId,
              runtimeMode: "full-access",
              activeRunId: null,
              archivedAt: null,
              deletedAt: null,
            } as OrchestrationV2ThreadShell),
        }),
        Layer.mock(ScheduledTasks.ScheduledTaskService)({}),
        Layer.succeed(ThreadSearch.ThreadSearch, {
          search: (input) => {
            received.push(input);
            return Effect.succeed({ matches: [], hasMore: false });
          },
        }),
      );
      const toolkit = yield* ThreadToolkit.pipe(
        Effect.provide(
          McpToolAccess.HandlersLayer.layer(ThreadHandlers.layer).pipe(Layer.provide(dependencies)),
        ),
      );
      for (const input of [
        { query: "decision" },
        { query: "decision", scope: "environment" as const, includeArchived: true, offset: 50 },
        { query: "decision", scope: "environment" as const, projectId: ProjectId.make("chosen") },
      ]) {
        const results = yield* toolkit
          .handle("t3_thread_search", input)
          .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
        expect(results.at(-1)?.result).toMatchObject({ matches: [], hasMore: false });
      }
      expect(received).toEqual([
        { query: "decision", projectId },
        { query: "decision", includeArchived: true, offset: 50 },
        { query: "decision", projectId: "chosen" },
      ]);
    }),
);
