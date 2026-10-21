import { DesktopAwakeState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { DesktopAwake } from "../../awake/DesktopAwake.ts";
import * as Channels from "../channels.ts";
import { makeIpcMethod } from "../DesktopIpc.ts";

export const getAwakeState = makeIpcMethod({
  channel: Channels.AWAKE_GET_STATE_CHANNEL,
  payload: Schema.Void,
  result: DesktopAwakeState,
  handler: Effect.fn("desktop.awake.state")(function* () {
    return yield* (yield* DesktopAwake).state;
  }),
});
export const setupAwake = makeIpcMethod({
  channel: Channels.AWAKE_SETUP_CHANNEL,
  payload: Schema.Void,
  result: DesktopAwakeState,
  handler: Effect.fn("desktop.awake.setup")(function* () {
    return yield* (yield* DesktopAwake).setup;
  }),
});
export const removeAwake = makeIpcMethod({
  channel: Channels.AWAKE_REMOVE_CHANNEL,
  payload: Schema.Void,
  result: DesktopAwakeState,
  handler: Effect.fn("desktop.awake.remove")(function* () {
    return yield* (yield* DesktopAwake).remove;
  }),
});
export const retryAwake = makeIpcMethod({
  channel: Channels.AWAKE_RETRY_CHANNEL,
  payload: Schema.Void,
  result: DesktopAwakeState,
  handler: Effect.fn("desktop.awake.retry")(function* () {
    return yield* (yield* DesktopAwake).retry;
  }),
});
