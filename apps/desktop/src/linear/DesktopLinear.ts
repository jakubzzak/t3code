import * as Clock from "effect/Clock";
import * as NodeCrypto from "node:crypto";
import { LinearDesktopRequest, LinearDesktopResult } from "@t3tools/contracts";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { DesktopEnvironment } from "../app/DesktopEnvironment.ts";
import { ElectronSafeStorage } from "../electron/ElectronSafeStorage.ts";
import { ElectronShell } from "../electron/ElectronShell.ts";
import { createLinearConnection } from "./linearConnection.ts";
import { receiveLinearCallback } from "./linearCallback.ts";

declare const __T3CODE_BUILD_LINEAR_CLIENT_ID__: string | undefined;
const buildClientId =
  typeof __T3CODE_BUILD_LINEAR_CLIENT_ID__ === "undefined" ? "" : __T3CODE_BUILD_LINEAR_CLIENT_ID__;

export class LinearConnectionError extends Schema.TaggedError<LinearConnectionError>()(
  "LinearConnectionError",
  { detail: Schema.String },
) {
  override get message() {
    return this.detail;
  }
}
export class DesktopLinear extends Context.Service<
  DesktopLinear,
  {
    readonly request: (
      input: LinearDesktopRequest,
    ) => Effect.Effect<LinearDesktopResult, LinearConnectionError>;
  }
>()("@t3tools/desktop/linear/DesktopLinear") {}

export const make = Effect.gen(function* () {
  const clock = yield* Clock.Clock;
  const environment = yield* DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const storage = yield* ElectronSafeStorage;
  const shell = yield* ElectronShell;
  const clientId = yield* Config.String("T3CODE_LINEAR_CLIENT_ID").pipe(
    Config.withDefault(buildClientId ?? ""),
  );
  const redirectUri = yield* Config.String("T3CODE_LINEAR_REDIRECT_URI").pipe(
    Config.withDefault("http://127.0.0.1:47289/linear/callback"),
  );
  const context = yield* Effect.context<never>();
  const runPromise = Effect.runPromiseWith(context);
  const file = environment.path.join(environment.stateDir, "linear-credentials.enc");
  const protectedStorage = Effect.gen(function* () {
    const available = yield* storage.isEncryptionAvailable;
    const backend = yield* storage.selectedStorageBackend;
    if (
      !available ||
      (environment.platform === "linux" &&
        !["gnome_libsecret", "kwallet", "kwallet5", "kwallet6"].includes(
          Option.getOrElse(backend, () => "unknown"),
        ))
    ) {
      return yield* new LinearConnectionError({
        detail:
          "Unlock your OS credential store before connecting Linear. Plaintext credential storage is not supported.",
      });
    }
  });
  const client = createLinearConnection({
    clientId,
    redirectUri,
    now: () => clock.currentTimeMillisUnsafe(),
    fetch: globalThis.fetch,
    read: () =>
      runPromise(
        Effect.gen(function* () {
          if (!(yield* fs.exists(file))) return null;
          yield* protectedStorage;
          return yield* storage.decryptString(yield* fs.readFile(file));
        }),
      ),
    write: (value) =>
      runPromise(
        Effect.gen(function* () {
          yield* protectedStorage;
          const encrypted = yield* storage.encryptString(value);
          const temporary = `${file}.${NodeCrypto.randomUUID()}.tmp`;
          yield* fs.makeDirectory(environment.stateDir, { recursive: true });
          yield* fs
            .writeFile(temporary, encrypted, { mode: 0o600 })
            .pipe(
              Effect.andThen(fs.rename(temporary, file)),
              Effect.ensuring(fs.remove(temporary, { force: true }).pipe(Effect.ignore)),
            );
        }),
      ),
    authorize: (url, state, signal) =>
      runPromise(
        Effect.gen(function* () {
          yield* protectedStorage;
          return yield* Effect.tryPromise(() =>
            receiveLinearCallback({
              redirectUri,
              authorizationUrl: url,
              state,
              signal,
              openExternal: (address) => runPromise(shell.openExternal(address)),
            }),
          );
        }),
      ),
  });
  return DesktopLinear.of({
    request: (input) =>
      Effect.tryPromise({
        try: () => client.request(input),
        catch: (error) =>
          new LinearConnectionError({
            detail: error instanceof Error ? error.message : "Linear connection failed. Try again.",
          }),
      }),
  });
});
export const layer = Layer.effect(DesktopLinear, make);
