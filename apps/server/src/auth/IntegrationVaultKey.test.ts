import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Layer from "effect/Layer";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as ServerConfig from "../config.ts";
import * as OsKeyring from "./IntegrationKeyring.ts";
import * as Vault from "./IntegrationVaultKey.ts";

const layer = ServerConfig.layerTest(process.cwd(), { prefix: "integration-vault-key-" });
it.effect("shares a single OS key across concurrent integration callers without a disk key", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(config.secretsDir, { recursive: true });
    yield* fs.writeFileString(config.environmentIdPath, "aabbccdd-1234-4123-8123-112233445566");
    const passwords = new Map<string, string>();
    let reads = 0,
      writes = 0;
    const key = yield* Vault.make.pipe(
      Effect.provideService(OsKeyring.IntegrationKeyring, {
        read: (account) =>
          Effect.sync(() => {
            reads++;
            return passwords.get(account);
          }),
        write: (account, value) =>
          Effect.sync(() => {
            writes++;
            passwords.set(account, value);
          }),
      }),
    );
    const keys = yield* Effect.all(
      Array.from({ length: 8 }, () => key.get),
      { concurrency: "unbounded" },
    );
    assert.equal(reads, 1);
    assert.equal(writes, 1);
    assert.equal(passwords.size, 1);
    for (const value of keys) {
      assert.equal(value.length, 32);
      assert.deepEqual(value, keys[0]);
    }
    assert.deepEqual(yield* fs.readDirectory(config.secretsDir), []);
    const moved = { ...config, secretsDir: `${config.secretsDir}-moved` };
    yield* fs.rename(config.secretsDir, moved.secretsDir);
    const reopened = yield* Vault.make.pipe(
      Effect.provideService(ServerConfig.ServerConfig, moved),
      Effect.provideService(OsKeyring.IntegrationKeyring, {
        read: (account) =>
          Effect.sync(() => {
            reads++;
            return passwords.get(account);
          }),
        write: () => Effect.die("Moving an environment must retain its OS key"),
      }),
    );
    assert.deepEqual(yield* reopened.get, keys[0]);
    assert.equal(reads, 2);
    assert.equal(writes, 1);
  }).pipe(Effect.provide(layer.pipe(Layer.provideMerge(NodeServices.layer))), Effect.scoped),
);
it.effect("does not replace a lost OS key when encrypted integration records remain", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(config.secretsDir, { recursive: true });
    yield* fs.writeFileString(config.environmentIdPath, "aabbccdd-1234-4123-8123-112233445566");
    yield* fs.writeFileString(
      `${config.secretsDir}/inbox-linear-fixture.bin`,
      "T3IV1:synthetic-encrypted-record",
    );
    let writes = 0;
    const key = yield* Vault.make.pipe(
      Effect.provideService(OsKeyring.IntegrationKeyring, {
        read: () => Effect.succeed(undefined),
        write: () =>
          Effect.sync(() => {
            writes++;
          }),
      }),
    );
    assert.equal((yield* Effect.result(key.get))._tag, "Failure");
    assert.equal(writes, 0);
    assert.equal(
      yield* fs.readFileString(`${config.secretsDir}/inbox-linear-fixture.bin`),
      "T3IV1:synthetic-encrypted-record",
    );
  }).pipe(Effect.provide(layer.pipe(Layer.provideMerge(NodeServices.layer))), Effect.scoped),
);
it.effect("retries a denied OS unlock without caching failure or falling back to a disk key", () =>
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(config.secretsDir, { recursive: true });
    yield* fs.writeFileString(config.environmentIdPath, "aabbccdd-1234-4123-8123-112233445566");
    let locked = true;
    const key = yield* Vault.make.pipe(
      Effect.provideService(OsKeyring.IntegrationKeyring, {
        read: () =>
          Effect.suspend(() =>
            locked
              ? Effect.fail(
                  new OsKeyring.IntegrationKeyringError({ cause: new Error("locked fixture") }),
                )
              : Effect.succeed(Buffer.alloc(32, 27).toString("base64")),
          ),
        write: () => Effect.die("Must not replace an existing OS key"),
      }),
    );
    assert.equal((yield* Effect.result(key.get))._tag, "Failure");
    locked = false;
    assert.deepEqual(yield* key.get, new Uint8Array(32).fill(27));
    assert.deepEqual(yield* fs.readDirectory(config.secretsDir), []);
  }).pipe(Effect.provide(layer.pipe(Layer.provideMerge(NodeServices.layer))), Effect.scoped),
);
