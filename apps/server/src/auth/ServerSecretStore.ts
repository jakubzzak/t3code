// @effect-diagnostics nodeBuiltinImport:off -- Authenticated encryption of environment integration records.
import * as NodeCrypto from "node:crypto";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Predicate from "effect/Predicate";
import * as PlatformError from "effect/PlatformError";
import * as Schema from "effect/Schema";

import * as ServerConfig from "../config.ts";
import * as IntegrationVault from "./IntegrationVaultKey.ts";

const vaultHeader = Buffer.from("T3IV1:");
const isIntegrationSecret = (name: string) => /^inbox-(?:linear|slack|superhuman)-/.test(name);
const decodeLegacyIntegration = Schema.decodeSync(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)),
);

const secretStoreErrorContext = {
  resource: Schema.String,
  cause: Schema.Defect(),
};

export class SecretStoreSecureError extends Schema.TaggedError<SecretStoreSecureError>()(
  "SecretStoreSecureError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to secure ${this.resource}.`;
  }
}

export class SecretStoreReadError extends Schema.TaggedError<SecretStoreReadError>()(
  "SecretStoreReadError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to read ${this.resource}.`;
  }
}

export class SecretStoreTemporaryPathError extends Schema.TaggedError<SecretStoreTemporaryPathError>()(
  "SecretStoreTemporaryPathError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to create temporary path for ${this.resource}.`;
  }
}

export class SecretStorePersistError extends Schema.TaggedError<SecretStorePersistError>()(
  "SecretStorePersistError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to persist ${this.resource}.`;
  }
}

export class SecretStoreRandomGenerationError extends Schema.TaggedError<SecretStoreRandomGenerationError>()(
  "SecretStoreRandomGenerationError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to generate random bytes for ${this.resource}.`;
  }
}

export class SecretStoreConcurrentReadError extends Schema.TaggedError<SecretStoreConcurrentReadError>()(
  "SecretStoreConcurrentReadError",
  {
    resource: Schema.String,
  },
) {
  override get message(): string {
    return `Failed to read ${this.resource} after concurrent creation.`;
  }
}

export class SecretStoreRemoveError extends Schema.TaggedError<SecretStoreRemoveError>()(
  "SecretStoreRemoveError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to remove ${this.resource}.`;
  }
}

export class SecretStoreDecodeError extends Schema.TaggedError<SecretStoreDecodeError>()(
  "SecretStoreDecodeError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to decode ${this.resource}.`;
  }
}

export class SecretStoreEncodeError extends Schema.TaggedError<SecretStoreEncodeError>()(
  "SecretStoreEncodeError",
  {
    ...secretStoreErrorContext,
  },
) {
  override get message(): string {
    return `Failed to encode ${this.resource}.`;
  }
}

export const SecretStoreError = Schema.Union([
  SecretStoreSecureError,
  SecretStoreReadError,
  SecretStoreTemporaryPathError,
  SecretStorePersistError,
  SecretStoreRandomGenerationError,
  SecretStoreConcurrentReadError,
  SecretStoreRemoveError,
  SecretStoreDecodeError,
  SecretStoreEncodeError,
]);
export type SecretStoreError = typeof SecretStoreError.Type;
export const isSecretStoreError = Schema.is(SecretStoreError);

const isPlatformError = (value: unknown): value is PlatformError.PlatformError =>
  Predicate.isTagged(value, "PlatformError");

export const isSecretAlreadyExistsError = (error: SecretStoreError): boolean =>
  "cause" in error && isPlatformError(error.cause) && error.cause.reason._tag === "AlreadyExists";

export class ServerSecretStore extends Context.Service<
  ServerSecretStore,
  {
    /** File-backed stores expose their directory for cross-process credential leases. */
    readonly directory?: string;
    readonly get: (name: string) => Effect.Effect<Option.Option<Uint8Array>, SecretStoreError>;
    readonly set: (name: string, value: Uint8Array) => Effect.Effect<void, SecretStoreError>;
    readonly create: (name: string, value: Uint8Array) => Effect.Effect<void, SecretStoreError>;
    readonly getOrCreateRandom: (
      name: string,
      bytes: number,
    ) => Effect.Effect<Uint8Array, SecretStoreError>;
    readonly remove: (name: string) => Effect.Effect<void, SecretStoreError>;
  }
>()("t3/auth/ServerSecretStore") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const serverConfig = yield* ServerConfig.ServerConfig;
  const vault = yield* IntegrationVault.IntegrationVaultKey;

  yield* fileSystem.makeDirectory(serverConfig.secretsDir, { recursive: true });
  yield* fileSystem.chmod(serverConfig.secretsDir, 0o700).pipe(
    Effect.mapError(
      (cause) =>
        new SecretStoreSecureError({
          resource: `secrets directory ${serverConfig.secretsDir}`,
          cause,
        }),
    ),
  );

  const resolveSecretPath = (name: string) => path.join(serverConfig.secretsDir, `${name}.bin`);
  const locked = <A>(name: string, task: Effect.Effect<A, SecretStoreError>) =>
    !isIntegrationSecret(name)
      ? task
      : IntegrationVault.withIntegrationVaultLease(resolveSecretPath(name), task).pipe(
          Effect.mapError((cause) =>
            isSecretStoreError(cause)
              ? cause
              : new SecretStoreSecureError({ resource: "integration credential lease", cause }),
          ),
        );
  const protect = (name: string, value: Uint8Array) =>
    !isIntegrationSecret(name)
      ? Effect.succeed(Uint8Array.from(value))
      : Effect.gen(function* () {
          const key = yield* vault.get;
          return yield* Effect.try({
            try: () => {
              const nonce = NodeCrypto.randomBytes(12);
              const cipher = NodeCrypto.createCipheriv("aes-256-gcm", key, nonce);
              cipher.setAAD(Buffer.from(name));
              const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
              return Uint8Array.from(
                Buffer.concat([vaultHeader, nonce, cipher.getAuthTag(), ciphertext]),
              );
            },
            catch: (cause) =>
              new SecretStoreEncodeError({ resource: "integration credential", cause }),
          });
        }).pipe(
          Effect.mapError((cause) =>
            isSecretStoreError(cause)
              ? cause
              : new SecretStoreSecureError({ resource: "integration vault", cause }),
          ),
        );

  const get: ServerSecretStore["Service"]["get"] = (name) =>
    locked(
      name,
      fileSystem.readFile(resolveSecretPath(name)).pipe(
        Effect.map((bytes) => Option.some(Uint8Array.from(bytes))),
        Effect.catch((cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.succeedNone
            : Effect.fail(
                new SecretStoreReadError({
                  resource: `secret ${name}`,
                  cause,
                }),
              ),
        ),
        Effect.flatMap((stored) => {
          if (Option.isNone(stored) || !isIntegrationSecret(name)) return Effect.succeed(stored);
          const bytes = stored.value;
          if (!Buffer.from(bytes.slice(0, vaultHeader.length)).equals(vaultHeader))
            return Effect.try({
              try: () =>
                decodeLegacyIntegration(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
              catch: (cause) =>
                new SecretStoreDecodeError({ resource: "legacy integration credential", cause }),
            }).pipe(Effect.andThen(persist(name, bytes)), Effect.as(stored));
          return vault.get.pipe(
            Effect.mapError(
              (cause) => new SecretStoreSecureError({ resource: "integration vault", cause }),
            ),
            Effect.flatMap((key) =>
              Effect.try({
                try: () => {
                  if (bytes.length < vaultHeader.length + 28)
                    throw new Error("Invalid encrypted credential.");
                  const offset = vaultHeader.length;
                  const decipher = NodeCrypto.createDecipheriv(
                    "aes-256-gcm",
                    key,
                    bytes.slice(offset, offset + 12),
                  );
                  decipher.setAAD(Buffer.from(name));
                  decipher.setAuthTag(bytes.slice(offset + 12, offset + 28));
                  return Option.some(
                    Uint8Array.from(
                      Buffer.concat([decipher.update(bytes.slice(offset + 28)), decipher.final()]),
                    ),
                  );
                },
                catch: (cause) =>
                  new SecretStoreDecodeError({ resource: "integration credential", cause }),
              }),
            ),
          );
        }),
        Effect.withSpan("ServerSecretStore.get"),
      ),
    );

  const persist: ServerSecretStore["Service"]["set"] = (name, value) => {
    const secretPath = resolveSecretPath(name);
    return protect(name, value).pipe(
      Effect.flatMap((encoded) =>
        crypto.randomUUIDv4().pipe(
          Effect.mapError(
            (cause) =>
              new SecretStoreTemporaryPathError({
                resource: `secret ${name}`,
                cause,
              }),
          ),
          Effect.flatMap((uuid) => {
            const tempPath = `${secretPath}.${uuid}.tmp`;
            return Effect.gen(function* () {
              yield* fileSystem.writeFile(tempPath, encoded);
              yield* fileSystem.chmod(tempPath, 0o600);
              yield* fileSystem.rename(tempPath, secretPath);
              yield* fileSystem.chmod(secretPath, 0o600);
            }).pipe(
              Effect.catch((cause) =>
                fileSystem.remove(tempPath).pipe(
                  Effect.ignore,
                  Effect.flatMap(() =>
                    Effect.fail(
                      new SecretStorePersistError({
                        resource: `secret ${name}`,
                        cause,
                      }),
                    ),
                  ),
                ),
              ),
            );
          }),
          Effect.withSpan("ServerSecretStore.set"),
        ),
      ),
    );
  };

  const set: ServerSecretStore["Service"]["set"] = (name, value) =>
    locked(name, persist(name, value));

  const create: ServerSecretStore["Service"]["create"] = (name, value) => {
    const secretPath = resolveSecretPath(name);
    return locked(
      name,
      Effect.scoped(
        Effect.gen(function* () {
          const encoded = yield* protect(name, value);
          const file = yield* fileSystem.open(secretPath, {
            flag: "wx",
            mode: 0o600,
          });
          yield* file.writeAll(encoded);
          yield* file.sync;
          yield* fileSystem.chmod(secretPath, 0o600);
        }),
      ).pipe(
        Effect.mapError((cause) =>
          isSecretStoreError(cause)
            ? cause
            : new SecretStorePersistError({ resource: `secret ${name}`, cause }),
        ),
      ),
    );
  };

  const getOrCreateRandom: ServerSecretStore["Service"]["getOrCreateRandom"] = (name, bytes) =>
    get(name).pipe(
      Effect.flatMap(
        Option.match({
          onSome: Effect.succeed,
          onNone: () =>
            crypto.randomBytes(bytes).pipe(
              Effect.mapError(
                (cause) =>
                  new SecretStoreRandomGenerationError({
                    resource: `secret ${name}`,
                    cause,
                  }),
              ),
              Effect.flatMap((generated) =>
                create(name, generated).pipe(
                  Effect.as(Uint8Array.from(generated)),
                  Effect.catchIf(isSecretStoreError, (error) =>
                    isSecretAlreadyExistsError(error)
                      ? get(name).pipe(
                          Effect.flatMap(
                            Option.match({
                              onSome: Effect.succeed,
                              onNone: () =>
                                Effect.fail(
                                  new SecretStoreConcurrentReadError({
                                    resource: `secret ${name}`,
                                  }),
                                ),
                            }),
                          ),
                        )
                      : Effect.fail(error),
                  ),
                ),
              ),
            ),
        }),
      ),
      Effect.withSpan("ServerSecretStore.getOrCreateRandom"),
    );

  const remove: ServerSecretStore["Service"]["remove"] = (name) =>
    locked(
      name,
      fileSystem.remove(resolveSecretPath(name)).pipe(
        Effect.catch((cause) =>
          cause.reason._tag === "NotFound"
            ? Effect.void
            : Effect.fail(
                new SecretStoreRemoveError({
                  resource: `secret ${name}`,
                  cause,
                }),
              ),
        ),
        Effect.withSpan("ServerSecretStore.remove"),
      ),
    );

  return ServerSecretStore.of({
    directory: serverConfig.secretsDir,
    get,
    set,
    create,
    getOrCreateRandom,
    remove,
  });
});

export const layer = Layer.effect(ServerSecretStore, make).pipe(
  Layer.provide(IntegrationVault.layer),
);
