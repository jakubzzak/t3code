import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as PlatformError from "effect/PlatformError";

import * as ServerConfig from "../config.ts";
import * as ServerSecretStore from "./ServerSecretStore.ts";
import * as IntegrationVault from "./IntegrationVaultKey.ts";

const layerServerConfig = () =>
  ServerConfig.layerTest(process.cwd(), { prefix: "t3-secret-store-test-" });

const layerServerSecretStore = () => Layer.provide(ServerSecretStore.layer, layerServerConfig());

const layerPermissionDeniedFileSystem = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    return {
      ...fileSystem,
      readFile: (path) =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "readFile",
            pathOrDescriptor: path,
            description: "Permission denied while reading secret file.",
          }),
        ),
    } satisfies FileSystem.FileSystem;
  }),
).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

const layerPermissionDeniedSecretStore = () =>
  ServerSecretStore.layer.pipe(
    Layer.provide(layerServerConfig()),
    Layer.provideMerge(layerPermissionDeniedFileSystem),
  );

const layerRenameFailureFileSystem = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;

    return {
      ...fileSystem,
      rename: (from, to) =>
        Effect.fail(
          PlatformError.systemError({
            _tag: "PermissionDenied",
            module: "FileSystem",
            method: "rename",
            pathOrDescriptor: `${String(from)} -> ${String(to)}`,
            description: "Permission denied while persisting secret file.",
          }),
        ),
    } satisfies FileSystem.FileSystem;
  }),
).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

const layerRenameFailureSecretStore = () =>
  ServerSecretStore.layer.pipe(
    Layer.provide(layerServerConfig()),
    Layer.provideMerge(layerRenameFailureFileSystem),
  );

const layerConcurrentReadMissFileSystem = Layer.effect(
  FileSystem.FileSystem,
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const readCountRef = yield* Ref.make(0);
    const readBarrier = yield* Deferred.make<void>();

    return {
      ...fileSystem,
      readFile: (path) =>
        /[\\/]session-signing-key\.bin$/.test(String(path))
          ? Ref.updateAndGet(readCountRef, (count) => count + 1).pipe(
              Effect.flatMap((count) => {
                if (count > 2) {
                  return fileSystem.readFile(path);
                }
                return Effect.gen(function* () {
                  if (count === 2) {
                    yield* Deferred.succeed(readBarrier, void 0);
                  }
                  yield* Deferred.await(readBarrier);
                  return yield* Effect.failCause(
                    Cause.fail(
                      PlatformError.systemError({
                        _tag: "NotFound",
                        module: "FileSystem",
                        method: "readFile",
                        pathOrDescriptor: String(path),
                        description: "Secret file does not exist yet.",
                      }),
                    ),
                  );
                });
              }),
            )
          : fileSystem.readFile(path),
    } satisfies FileSystem.FileSystem;
  }),
).pipe(Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)));

const layerConcurrentCreateSecretStore = () =>
  ServerSecretStore.layer.pipe(
    Layer.provide(layerServerConfig()),
    Layer.provideMerge(layerConcurrentReadMissFileSystem),
  );

it.layer(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))("ServerSecretStore.layer", (it) => {
  it.effect("reuses an existing secret instead of regenerating it", () =>
    Effect.gen(function* () {
      const secretStore = yield* ServerSecretStore.ServerSecretStore;

      const first = yield* secretStore.getOrCreateRandom("session-signing-key", 32);
      const second = yield* secretStore.getOrCreateRandom("session-signing-key", 32);

      assert.deepEqual(Array.from(second), Array.from(first));
    }).pipe(Effect.provide(layerServerSecretStore())),
  );

  it.effect("returns the persisted secret when concurrent creators race", () =>
    Effect.gen(function* () {
      const secretStore = yield* ServerSecretStore.ServerSecretStore;

      const [first, second] = yield* Effect.all(
        [
          secretStore.getOrCreateRandom("session-signing-key", 32),
          secretStore.getOrCreateRandom("session-signing-key", 32),
        ],
        { concurrency: "unbounded" },
      );
      const persisted = yield* secretStore.get("session-signing-key");
      const persistedBytes = Option.getOrThrow(persisted);

      assert.deepEqual(Array.from(first), Array.from(persistedBytes));
      assert.deepEqual(Array.from(second), Array.from(persistedBytes));
    }).pipe(Effect.provide(layerConcurrentCreateSecretStore())),
  );

  it.effect("propagates read failures other than missing-file errors", () =>
    Effect.gen(function* () {
      const secretStore = yield* ServerSecretStore.ServerSecretStore;

      const error = yield* Effect.flip(secretStore.getOrCreateRandom("session-signing-key", 32));

      assert.instanceOf(error, ServerSecretStore.SecretStoreReadError);
      assert.include(error.message, "Failed to read secret session-signing-key.");
      assert.instanceOf(error.cause, PlatformError.PlatformError);
      assert.equal((error.cause as PlatformError.PlatformError).reason._tag, "PermissionDenied");
    }).pipe(Effect.provide(layerPermissionDeniedSecretStore())),
  );

  it.effect("propagates write failures instead of treating them as success", () =>
    Effect.gen(function* () {
      const secretStore = yield* ServerSecretStore.ServerSecretStore;

      const error = yield* Effect.flip(
        secretStore.set("session-signing-key", Uint8Array.from([1, 2, 3])),
      );

      assert.instanceOf(error, ServerSecretStore.SecretStorePersistError);
      assert.include(error.message, "Failed to persist secret session-signing-key.");
      assert.instanceOf(error.cause, PlatformError.PlatformError);
      assert.equal((error.cause as PlatformError.PlatformError).reason._tag, "PermissionDenied");
    }).pipe(Effect.provide(layerRenameFailureSecretStore())),
  );
});

it.effect(
  "encrypts separate integration records with one vault key and authenticates their identity",
  () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const store = yield* ServerSecretStore.make.pipe(
        Effect.provideService(IntegrationVault.IntegrationVaultKey, {
          get: Effect.succeed(new Uint8Array(32).fill(17)),
        }),
      );
      const token = new TextEncoder().encode("fixture-sensitive-access-and-refresh");
      for (const source of ["linear", "slack", "superhuman"]) {
        const name = `inbox-${source}-fixture`;
        yield* store.set(name, token);
        const bytes = yield* fs.readFile(`${config.secretsDir}/${name}.bin`);
        assert.notInclude(new TextDecoder().decode(bytes), "fixture-sensitive");
        assert.equal(new TextDecoder().decode(bytes.slice(0, 6)), "T3IV1:");
        assert.deepEqual(Option.getOrThrow(yield* store.get(name)), token);
      }
      const ciphertext = yield* fs.readFile(`${config.secretsDir}/inbox-linear-fixture.bin`);
      yield* fs.writeFile(`${config.secretsDir}/inbox-slack-fixture.bin`, ciphertext);
      assert.equal((yield* Effect.result(store.get("inbox-slack-fixture")))._tag, "Failure");
      ciphertext[ciphertext.length - 1]! ^= 1;
      yield* fs.writeFile(`${config.secretsDir}/inbox-linear-fixture.bin`, ciphertext);
      assert.equal((yield* Effect.result(store.get("inbox-linear-fixture")))._tag, "Failure");
    }).pipe(
      Effect.provide(
        layerServerConfig().pipe(
          Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
        ),
      ),
      Effect.scoped,
    ),
);

it.effect(
  "migrates plaintext integration records on read without altering unrelated authentication secrets",
  () =>
    Effect.gen(function* () {
      const config = yield* ServerConfig.ServerConfig;
      const fs = yield* FileSystem.FileSystem;
      const store = yield* ServerSecretStore.make.pipe(
        Effect.provideService(IntegrationVault.IntegrationVaultKey, {
          get: Effect.succeed(new Uint8Array(32).fill(23)),
        }),
      );
      const token = new TextEncoder().encode('{"accessToken":"legacy-fixture"}');
      const file = `${config.secretsDir}/inbox-linear-legacy.bin`;
      yield* fs.writeFile(file, token);
      assert.deepEqual(Option.getOrThrow(yield* store.get("inbox-linear-legacy")), token);
      assert.equal(new TextDecoder().decode((yield* fs.readFile(file)).slice(0, 6)), "T3IV1:");
      yield* store.set("server-auth-fixture", token);
      assert.deepEqual(yield* fs.readFile(`${config.secretsDir}/server-auth-fixture.bin`), token);
    }).pipe(
      Effect.provide(
        layerServerConfig().pipe(
          Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
        ),
      ),
      Effect.scoped,
    ),
);

it.effect("fails closed on unavailable OS key access without writing or replacing plaintext", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const store = yield* ServerSecretStore.make.pipe(
      Effect.provideService(IntegrationVault.IntegrationVaultKey, {
        get: Effect.fail(
          new IntegrationVault.IntegrationVaultKeyError({
            cause: new Error("synthetic locked keyring"),
          }),
        ),
      }),
    );
    const token = new TextEncoder().encode("existing-fixture");
    const file = `${config.secretsDir}/inbox-linear-locked.bin`;
    yield* fs.writeFile(file, token);
    assert.equal((yield* Effect.result(store.get("inbox-linear-locked")))._tag, "Failure");
    assert.deepEqual(yield* fs.readFile(file), token);
    assert.equal((yield* Effect.result(store.set("inbox-slack-new", token)))._tag, "Failure");
    assert.isFalse(yield* fs.exists(`${config.secretsDir}/inbox-slack-new.bin`));
  }).pipe(
    Effect.provide(
      layerServerConfig().pipe(
        Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
      ),
    ),
    Effect.scoped,
  ),
);
