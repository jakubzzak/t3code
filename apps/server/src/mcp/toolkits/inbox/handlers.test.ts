import { expect, it } from "@effect/vitest";
import { CommandId, EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as ReplyTransport from "../../../inbox/InboxReplyTransport.ts";
import * as Inbox from "../../../inbox/InboxService.ts";
import { ingestInboxItem } from "../../../inbox/inboxState.ts";
import * as Threads from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Invocation from "../../McpInvocationContext.ts";
import * as Access from "../../McpToolAccess.ts";
import * as Handlers from "./handlers.ts";
import { InboxToolkit } from "./tools.ts";
it.effect(
  "allows read-only clients to inspect notifications but only full-access clients to triage",
  () =>
    Effect.gen(function* () {
      const projectId = ProjectId.make("project");
      const notification = ingestInboxItem(projectId, {
        id: "item",
        source: "linear",
        connectionId: "workspace",
        groupId: "issue",
        title: "Review",
        content: "Review please",
        author: "Alex",
        location: "ENG-1",
        url: "https://linear.app",
        occurredAt: "2026-10-22T10:00:00Z",
      });
      for (const access of ["read-only", "auto-accept-edits", "full-access"] as const) {
        let changed = false;
        let replied = false;
        const dependencies = Layer.mergeAll(
          Layer.succeed(Invocation.McpInvocationContext, {
            environmentId: EnvironmentId.make("environment"),
            requestNamespace: "inbox-test",
            thread: undefined,
            client: { sessionId: "inbox-test", label: "Test", access },
            issuedAt: 0,
            capabilities: new Set(["orchestration" as const]),
          }),
          Layer.mock(Threads.ThreadManagementService)({}),
          Layer.mock(ReplyTransport.InboxReplyTransport)({}),
          Layer.mock(Inbox.InboxService)({
            reply: (input, check) =>
              Effect.gen(function* () {
                if (check) yield* check;
                replied = true;
                return { ...input, status: "sent" as const };
              }),
            list: () => Effect.succeed([notification]),
            get: () => Effect.succeed(notification),
            mutate: (_, check) =>
              Effect.gen(function* () {
                if (check) yield* check;
                changed = true;
                return { notification, openThread: false, undoCommandId: null };
              }),
          }),
        );
        const toolkit = yield* InboxToolkit.pipe(
          Effect.provide(
            Access.HandlersLayer.layer(Handlers.layer).pipe(Layer.provide(dependencies)),
          ),
        );
        const read = yield* toolkit
          .handle("inbox_read", { projectId, id: notification.id })
          .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
        expect(read.at(-1)?.result).toMatchObject({ id: notification.id });
        const write = yield* toolkit
          .handle("inbox_update", {
            projectId,
            id: notification.id,
            commandId: CommandId.make("triage"),
            expectedRevision: 0,
            action: { type: "resolve", resolved: true },
          })
          .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
        const reply = yield* toolkit
          .handle("inbox_reply", {
            projectId,
            id: notification.id,
            itemId: "item",
            commandId: CommandId.make("confirmed-reply"),
            target: { source: "linear", issueId: "issue", parentId: null },
            text: "Confirmed by user.",
          })
          .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
        expect(replied).toBe(access === "full-access");
        if (access !== "full-access")
          expect(reply.at(-1)?.result).toMatchObject({ code: expect.stringMatching(/denied/) });
        expect(changed).toBe(access === "full-access");
        if (access !== "full-access")
          expect(write.at(-1)?.result).toMatchObject({ code: expect.stringMatching(/denied/) });
      }
    }),
);
