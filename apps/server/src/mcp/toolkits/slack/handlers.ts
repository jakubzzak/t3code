import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Slack from "../../../inbox/SlackService.ts";
import * as Access from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { SlackToolkit } from "./tools.ts";

const error = (cause: Slack.SlackError) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: cause.message });

export const layer = Access.toLayer(SlackToolkit, {
  slack_read: Access.reads((input) =>
    Effect.gen(function* () {
      yield* readCaller();
      return yield* (yield* Slack.SlackService).read(input).pipe(Effect.mapError(error));
    }),
  ),
  slack_send: Access.writesEnvironment((input, check) =>
    Effect.gen(function* () {
      return yield* (yield* Slack.SlackService)
        .send(input, Effect.asVoid(check))
        .pipe(Effect.mapError((cause) => (cause._tag === "SlackError" ? error(cause) : cause)));
    }),
  ),
});
