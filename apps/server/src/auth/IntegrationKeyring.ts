// @effect-diagnostics nodeBuiltinImport:off -- Lazy native OS keyring adapter; credentials never pass through shell arguments.
import * as NodeModule from "node:module";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
export class IntegrationKeyringError extends Schema.TaggedError<IntegrationKeyringError>()(
  "IntegrationKeyringError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return "Could not access this environment's OS integration key.";
  }
}
export class IntegrationKeyring extends Context.Service<
  IntegrationKeyring,
  {
    readonly read: (account: string) => Effect.Effect<string | undefined, IntegrationKeyringError>;
    readonly write: (
      account: string,
      value: string,
    ) => Effect.Effect<void, IntegrationKeyringError>;
  }
>()("t3/auth/IntegrationKeyring") {}
const requireForKeyring = NodeModule.createRequire(import.meta.url);
export const layer = Layer.sync(IntegrationKeyring, () => {
  const entry = (account: string) => {
    const { AsyncEntry } = requireForKeyring(
      "@napi-rs/keyring",
    ) as typeof import("@napi-rs/keyring");
    return new AsyncEntry("T3 Code integration vault", account);
  };
  return IntegrationKeyring.of({
    read: (account) =>
      Effect.tryPromise({
        try: (signal) => entry(account).getPassword(signal),
        catch: (cause) => new IntegrationKeyringError({ cause }),
      }),
    write: (account, value) =>
      Effect.tryPromise({
        try: (signal) => entry(account).setPassword(value, signal),
        catch: (cause) => new IntegrationKeyringError({ cause }),
      }),
  });
});
