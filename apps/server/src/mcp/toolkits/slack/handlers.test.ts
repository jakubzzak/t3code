import { expect, it } from "@effect/vitest";
import { CommandId, EnvironmentId, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Slack from "../../../inbox/SlackService.ts";
import * as Threads from "../../../orchestration-v2/ThreadManagementService.ts";
import * as Invocation from "../../McpInvocationContext.ts";
import * as Access from "../../McpToolAccess.ts";
import * as Handlers from "./handlers.ts";
import { SlackToolkit } from "./tools.ts";

it.effect.each(["read-only", "auto-accept-edits", "full-access"] as const)(
  "allows Slack reads and guards sends for %s clients",
  (access) =>
    Effect.gen(function* () {
      let sent = false;
      const dependencies = Layer.mergeAll(
        Layer.succeed(Invocation.McpInvocationContext, {
          environmentId: EnvironmentId.make("environment"),
          requestNamespace: "slack-test",
          thread: undefined,
          client: { sessionId: "slack-test", label: "Test", access },
          issuedAt: 0,
          capabilities: new Set(["orchestration" as const]),
        }),
        Layer.mock(Threads.ThreadManagementService)({}),
        Layer.succeed(Slack.SlackService, {
          read: () => Effect.succeed({ ok: true, team_id: "T1", user_id: "U1" }),
          send: (input, check) =>
            Effect.gen(function* () {
              if (check) yield* check;
              sent = true;
              return {
                commandId: input.commandId,
                status: "sent" as const,
                channelId: "D1",
                ts: "1.000001",
              };
            }),
        }),
      );
      const toolkit = yield* SlackToolkit.pipe(
        Effect.provide(
          Access.HandlersLayer.layer(Handlers.layer).pipe(Layer.provide(dependencies)),
        ),
      );
      const projectId = ProjectId.make("project");
      const read = yield* toolkit
        .handle("slack_read", { projectId, method: "auth.test", parameters: {} })
        .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
      expect(read.at(-1)?.result).toMatchObject({ ok: true });
      const write = yield* toolkit
        .handle("slack_send", {
          projectId,
          commandId: CommandId.make("confirmed"),
          connectionId: "T1:U1",
          destination: { userIds: ["U2"] },
          text: "Confirmed by user.",
        })
        .pipe(Stream.unwrap, Stream.runCollect, Effect.provide(dependencies));
      expect(sent).toBe(access === "full-access");
      if (access !== "full-access")
        expect(write.at(-1)?.result).toMatchObject({ code: expect.stringMatching(/denied/) });
    }),
);
