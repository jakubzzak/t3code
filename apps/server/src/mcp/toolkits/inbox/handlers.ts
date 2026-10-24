import { OrchestratorMcpFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { InboxService } from "../../../inbox/InboxService.ts";
import * as Access from "../../McpToolAccess.ts";
import { readCaller } from "../../threadAccess.ts";
import { InboxToolkit } from "./tools.ts";
const error = (cause: { detail: string }) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: cause.detail });
export const layer = Access.toLayer(InboxToolkit, {
  inbox_list: Access.reads((input) =>
    Effect.gen(function* () {
      yield* readCaller();
      return yield* (yield* InboxService).list(input).pipe(Effect.mapError(error));
    }),
  ),
  inbox_read: Access.reads((input) =>
    Effect.gen(function* () {
      yield* readCaller();
      return yield* (yield* InboxService).get(input).pipe(Effect.mapError(error));
    }),
  ),
  inbox_update: Access.writesEnvironment((input, check) =>
    Effect.gen(function* () {
      return yield* (yield* InboxService)
        .mutate(input, Effect.asVoid(check))
        .pipe(Effect.mapError((cause) => (cause._tag === "InboxError" ? error(cause) : cause)));
    }),
  ),
});
