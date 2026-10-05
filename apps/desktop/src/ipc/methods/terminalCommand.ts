import { DesktopTerminalCommandState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as DesktopTerminalCommand from "../../app/DesktopTerminalCommand.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const get = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.TERMINAL_COMMAND_GET_CHANNEL,
  payload: Schema.Void,
  result: DesktopTerminalCommandState,
  handler: Effect.fn("desktop.ipc.terminalCommand.get")(function* () {
    return yield* (yield* DesktopTerminalCommand.DesktopTerminalCommand).get;
  }),
});
export const install = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.TERMINAL_COMMAND_INSTALL_CHANNEL,
  payload: Schema.Void,
  result: DesktopTerminalCommandState,
  handler: Effect.fn("desktop.ipc.terminalCommand.install")(function* () {
    return yield* (yield* DesktopTerminalCommand.DesktopTerminalCommand).install;
  }),
});
export const remove = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.TERMINAL_COMMAND_REMOVE_CHANNEL,
  payload: Schema.Void,
  result: DesktopTerminalCommandState,
  handler: Effect.fn("desktop.ipc.terminalCommand.remove")(function* () {
    return yield* (yield* DesktopTerminalCommand.DesktopTerminalCommand).remove;
  }),
});
