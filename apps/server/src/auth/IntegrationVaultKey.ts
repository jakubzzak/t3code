// @effect-diagnostics nodeBuiltinImport:off -- Native OS credential storage protects the integration vault's master key.
import * as NodeCrypto from "node:crypto";
import * as NodePath from "node:path";
import { lock } from "proper-lockfile";
import { EnvironmentId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as ServerConfig from "../config.ts";
import * as OsKeyring from "./IntegrationKeyring.ts";

export class IntegrationVaultKeyError extends Schema.TaggedError<IntegrationVaultKeyError>()(
  "IntegrationVaultKeyError",
  { cause: Schema.Defect() },
) {
  override get message() {
    return "Could not unlock the integration vault in this environment's OS credential store.";
  }
}
export class IntegrationVaultKey extends Context.Service<
  IntegrationVaultKey,
  {
    readonly get: Effect.Effect<Uint8Array, IntegrationVaultKeyError>;
  }
>()("t3/auth/IntegrationVaultKey") {}

/** Serialize vault key creation and credential conversion across environment processes. */
export const withIntegrationVaultLease = <A, E, R>(file: string, task: Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const compromised = yield* Deferred.make<never, IntegrationVaultKeyError>();
      const services = yield* Effect.context<never>();
      yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: () =>
            lock(file, {
              realpath: false,
              stale: 120_000,
              update: 10_000,
              retries: { retries: 40, factor: 1, minTimeout: 250, maxTimeout: 250 },
              onCompromised: (cause) =>
                Effect.runSyncWith(services)(
                  Deferred.fail(compromised, new IntegrationVaultKeyError({ cause })),
                ),
            }),
          catch: (cause) => new IntegrationVaultKeyError({ cause }),
        }),
        (release) => Effect.promise(() => release()).pipe(Effect.ignore),
      );
      return yield* Effect.raceFirst(task, Deferred.await(compromised));
    }),
  );

/** @public Tests provide a synthetic keyring; live construction uses the native OS adapter. */
export const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const keyring = yield* OsKeyring.IntegrationKeyring;
  const fs = yield* FileSystem.FileSystem;
  const mutex = yield* Semaphore.make(1);
  let cached: Uint8Array | undefined;
  const fail = (cause: unknown) => new IntegrationVaultKeyError({ cause });
  const acquire = withIntegrationVaultLease(
    NodePath.join(config.secretsDir, "integration-vault-key"),
    Effect.gen(function* () {
      // The existing persisted environment ID survives directory moves; no key lives in T3 home.
      const account = yield* fs.readFileString(config.environmentIdPath).pipe(
        Effect.map((value) => value.trim()),
        Effect.flatMap(Schema.decodeEffect(EnvironmentId)),
        Effect.mapError(fail),
      );
      let password = yield* keyring.read(account).pipe(Effect.mapError(fail));
      if (!password) {
        // Losing a key must never silently create a replacement over encrypted records.
        const names = yield* fs.readDirectory(config.secretsDir).pipe(Effect.mapError(fail));
        for (const name of names.filter((name) =>
          /^inbox-(?:linear|slack|superhuman)-.*\.bin$/.test(name),
        )) {
          const bytes = yield* fs
            .readFile(NodePath.join(config.secretsDir, name))
            .pipe(Effect.mapError(fail));
          if (new TextDecoder().decode(bytes.slice(0, 6)) === "T3IV1:")
            return yield* fail(new Error("An existing integration vault key is missing."));
        }
        password = yield* Effect.try({
          try: () => NodeCrypto.randomBytes(32).toString("base64"),
          catch: fail,
        });
        yield* keyring.write(account, password).pipe(Effect.mapError(fail));
      }
      const key = Buffer.from(password, "base64");
      if (key.length !== 32 || key.toString("base64") !== password)
        return yield* fail(new Error("The integration vault key is invalid."));
      return Uint8Array.from(key);
    }),
  );
  return IntegrationVaultKey.of({
    get: mutex.withPermits(1)(
      Effect.gen(function* () {
        if (cached) return cached;
        const key = yield* acquire.pipe(
          Effect.timeoutOrElse({
            duration: "30 seconds",
            orElse: () => fail(new Error("OS credential access timed out.")),
          }),
        );
        cached = key;
        return key;
      }),
    ),
  });
});
export const layer = Layer.effect(IntegrationVaultKey, make).pipe(Layer.provide(OsKeyring.layer));
