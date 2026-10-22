import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import { ProjectId } from "@t3tools/contracts";
import { sealLinearConnection } from "@t3tools/shared/linearConnectionTransfer";
import * as Connection from "./LinearConnection.ts";
import * as Settings from "../serverSettings.ts";
import * as Secrets from "../auth/ServerSecretStore.ts";
const first = ProjectId.make("first");
const second = ProjectId.make("second");
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
