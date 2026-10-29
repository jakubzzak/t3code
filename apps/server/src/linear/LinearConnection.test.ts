import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import { ProjectId } from "@t3tools/contracts";
import { sealLinearConnection } from "@t3tools/shared/linearConnectionTransfer";
import * as Connection from "./LinearConnection.ts";
import * as Settings from "../serverSettings.ts";
import * as Secrets from "../auth/ServerSecretStore.ts";
const first = ProjectId.make("first");
const second = ProjectId.make("second");
it.effect(
  "uses the selected project's client ID for PKCE without a build-specific application",
  () =>
    Effect.gen(function* () {
      const values = new Map<string, Uint8Array>();
      const secrets = Secrets.ServerSecretStore.of({
        get: (key) => Effect.sync(() => Option.fromUndefinedOr(values.get(key))),
        set: (key, value) =>
          Effect.sync(() => {
            values.set(key, value);
          }),
        create: () => Effect.die("Not used"),
        remove: () => Effect.void,
        getOrCreateRandom: () => Effect.die("Not used"),
      });
      yield* Effect.gen(function* () {
        const service = yield* Connection.LinearConnection;
        const status = yield* service.request(first, {
          operation: "status",
          workspace: "acme",
          connectionKey: first,
        });
        assert.isTrue(status.configured);
        const url = new URL(yield* service.begin(first, "https://blackbird.example.test"));
        assert.equal(url.searchParams.get("client_id"), "custom-public-client");
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        assert.equal(url.searchParams.get("scope"), "read,comments:create");
        assert.isFalse(url.searchParams.has("client_secret"));
        yield* service.cancel(first);
      }).pipe(
        Effect.provide(
          Connection.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(Secrets.ServerSecretStore, secrets),
                Settings.layerTest({
                  projectSettingsOverrides: {
                    [first]: { linearWorkspace: "acme", linearClientId: "custom-public-client" },
                  },
                }),
              ),
            ),
          ),
        ),
      );
    }).pipe(Effect.scoped),
);
it.effect(
  "binds encrypted migration to one selected project, rejects replay and expiry, and never replaces an existing connection",
  () =>
    Effect.gen(function* () {
      const values = new Map<string, Uint8Array>();
      const secrets = Secrets.ServerSecretStore.of({
        get: (key) => Effect.sync(() => Option.fromUndefinedOr(values.get(key))),
        set: (key, value) =>
          Effect.sync(() => {
            values.set(key, value);
          }),
        create: (key, value) =>
          Effect.sync(() => {
            values.set(key, value);
          }),
        remove: (key) =>
          Effect.sync(() => {
            values.delete(key);
          }),
        getOrCreateRandom: () => Effect.die("Not used"),
      });
      const credential = JSON.stringify({
        clientId: "legacy-client",
        connection: {
          workspace: "acme",
          userId: "user",
          name: "Sample",
          email: "sample@example.test",
        },
        accessToken: "fixture-access",
        refreshToken: "fixture-refresh",
        expiresAt: 86400_000,
      });
      yield* Effect.gen(function* () {
        const service = yield* Connection.LinearConnection;
        const ticket = yield* service.prepareMigration(first);
        const envelope = sealLinearConnection(credential, ticket.publicKey);
        assert.equal(
          (yield* Effect.result(service.importMigration(second, ticket.ticket, envelope)))._tag,
          "Failure",
        );
        yield* service.importMigration(first, ticket.ticket, envelope);
        assert.equal(values.size, 1);
        assert.equal(
          (yield* Effect.result(service.importMigration(first, ticket.ticket, envelope)))._tag,
          "Failure",
        );
        const status = yield* service.request(first, {
          operation: "status",
          workspace: "acme",
          connectionKey: "ignored-client-key",
        });
        assert.equal(status.connection?.userId, "user");
        assert.equal(
          (yield* service.request(second, {
            operation: "status",
            workspace: "acme",
            connectionKey: first,
          })).connection,
          null,
        );
        assert.notInclude(JSON.stringify(status), "fixture-access");
        const replacement = yield* service.prepareMigration(first);
        assert.equal(
          (yield* Effect.result(
            service.importMigration(
              first,
              replacement.ticket,
              sealLinearConnection(credential, replacement.publicKey),
            ),
          ))._tag,
          "Failure",
        );
        const expired = yield* service.prepareMigration(second);
        yield* TestClock.adjust("11 minutes");
        assert.equal(
          (yield* Effect.result(
            service.importMigration(
              second,
              expired.ticket,
              sealLinearConnection(credential, expired.publicKey),
            ),
          ))._tag,
          "Failure",
        );
        assert.equal(values.size, 1);
      }).pipe(
        Effect.provide(
          Connection.layer.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(Secrets.ServerSecretStore, secrets),
                Settings.layerTest({
                  projectSettingsOverrides: {
                    [first]: { linearWorkspace: "acme" },
                    [second]: { linearWorkspace: "acme" },
                  },
                }),
              ),
            ),
          ),
        ),
      );
    }).pipe(Effect.scoped),
);

it.effect("shares a single pending authorization across concurrent project clients", () =>
  Effect.gen(function* () {
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let configurationReads = 0;
    const originalSettings = Settings.layerTest({
      projectSettingsOverrides: {
        [first]: { linearWorkspace: "acme", linearClientId: "public-fixture-client" },
      },
    });
    const settings = Layer.effect(
      Settings.ServerSettingsService,
      Effect.map(Settings.ServerSettingsService, (service) => ({
        ...service,
        getSettings: service.getSettings.pipe(
          Effect.tap(() =>
            Effect.gen(function* () {
              configurationReads++;
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
            }),
          ),
        ),
      })),
    ).pipe(Layer.provide(originalSettings));
    yield* Effect.gen(function* () {
      const connection = yield* Connection.LinearConnection;
      const a = yield* connection.begin(first, "https://first.example.test").pipe(Effect.forkChild);
      yield* Deferred.await(entered);
      const b = yield* connection
        .begin(first, "https://second.example.test")
        .pipe(Effect.forkChild);
      yield* Effect.yieldNow;
      assert.equal(
        configurationReads,
        1,
        "A second client must join before async configuration reads",
      );
      yield* Deferred.succeed(release, undefined);
      const urlA = yield* Fiber.join(a);
      const urlB = yield* Fiber.join(b);
      assert.equal(urlA, urlB);
      assert.equal(
        new URL(urlA).searchParams.get("redirect_uri"),
        "https://first.example.test/oauth/linear/callback",
      );
      yield* connection.cancel(first);
    }).pipe(
      Effect.provide(
        Connection.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              settings,
              Layer.mock(Secrets.ServerSecretStore)({
                get: () => Effect.succeed(Option.none()),
                set: () => Effect.void,
              }),
            ),
          ),
        ),
      ),
    );
  }).pipe(Effect.scoped),
);

it.effect(
  "keeps the existing read connection available after canceling a reply-permission upgrade",
  () => {
    const credential = JSON.stringify({
      [first]: {
        clientId: "fixture-client",
        accessToken: "fixture-access",
        refreshToken: "fixture-refresh",
        expiresAt: 9999999999999,
        connection: { workspace: "acme", userId: "me", name: "Me", email: "me@example.test" },
      },
    });
    return Effect.gen(function* () {
      const connection = yield* Connection.LinearConnection;
      yield* connection.begin(first, "https://example.test");
      yield* connection.cancel(first);
      const status = yield* connection.request(first, {
        operation: "status",
        workspace: "acme",
        connectionKey: first,
      });
      assert.equal(status.connection?.userId, "me");
    }).pipe(
      Effect.provide(
        Connection.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Settings.layerTest({
                projectSettingsOverrides: {
                  [first]: { linearWorkspace: "acme", linearClientId: "fixture-client" },
                },
              }),
              Layer.mock(Secrets.ServerSecretStore)({
                get: () => Effect.succeedSome(new TextEncoder().encode(credential)),
                set: () => Effect.die("Cancel must not replace credentials"),
              }),
            ),
          ),
        ),
      ),
      Effect.scoped,
    );
  },
);
