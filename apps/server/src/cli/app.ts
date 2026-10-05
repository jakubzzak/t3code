import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import { Argument, Command } from "effect/unstable/cli";

import * as DesktopAppLauncher from "../desktop/DesktopAppLauncher.ts";
import { baseDirFlag } from "./config.ts";

export const openDesktopProject = Effect.fn("cli.openDesktopProject")(function* (flags: {
  readonly baseDir: Option.Option<string>;
  readonly workspaceRoot: Option.Option<string>;
  readonly startIfNeeded?: boolean;
}) {
  const launcher = yield* DesktopAppLauncher.DesktopAppLauncher;
  yield* launcher.open(flags);
}, Effect.provide(DesktopAppLauncher.layer));

export const appCommand = Command.make("app", {
  baseDir: baseDirFlag,
  workspaceRoot: Argument.String("path").pipe(
    Argument.withDescription("Project directory. Default: current directory."),
    Argument.optional,
  ),
}).pipe(
  Command.withDescription("Open a project in the running T3 Code desktop app."),
  Command.withHandler(openDesktopProject),
);
