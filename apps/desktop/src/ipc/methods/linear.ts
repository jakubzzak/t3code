import { LinearDesktopRequest, LinearDesktopResult } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import { DesktopLinear } from "../../linear/DesktopLinear.ts";
import * as DesktopIpc from "../DesktopIpc.ts";
import * as IpcChannels from "../channels.ts";

export const linearRequest = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LINEAR_REQUEST_CHANNEL,
  payload: LinearDesktopRequest,
  result: LinearDesktopResult,
  handler: Effect.fn("desktop.ipc.linear.request")(function* (input) {
    return yield* (yield* DesktopLinear).request(input);
  }),
});
