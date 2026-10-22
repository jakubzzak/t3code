import * as Linear from "../linear/LinearConnection.ts";
import * as Superhuman from "./SuperhumanConnection.ts";
import * as Redacted from "effect/Redacted";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { InboxError, ProjectId } from "@t3tools/contracts";
import * as Sources from "./InboxSources.ts";
import * as Transport from "./InboxSourceTransport.ts";
import * as Inbox from "./InboxService.ts";
import * as Secrets from "../auth/ServerSecretStore.ts";
import * as Settings from "../serverSettings.ts";
import * as Sqlite from "../persistence/Sqlite.ts";
it.effect(
  "isolates connections by project, pauses disabled inboxes, retains sync history on failures, and disconnects",
  () =>
    Effect.gen(function* () {
      const credentials = new Map<string, Uint8Array>();
      const calls = yield* Ref.make(0);
      const fail = yield* Ref.make(false);
      const ingested = yield* Ref.make(0);
      const secrets = Secrets.ServerSecretStore.of({
        get: (key) => Effect.sync(() => Option.fromUndefinedOr(credentials.get(key))),
        set: (key, value) =>
          Effect.sync(() => {
            credentials.set(key, value);
          }),
        create: (key, value) =>
          Effect.sync(() => {
            credentials.set(key, value);
          }),
        remove: (key) =>
          Effect.sync(() => {
            credentials.delete(key);
          }),
        getOrCreateRandom: () => Effect.die("Not used in this test"),
      });
      const transport = Transport.InboxSourceTransport.of({
        read: () =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (count) => count + 1);
            if (yield* Ref.get(fail))
              return yield* new InboxError({ detail: "Slack permission missing" });
            return [];
          }),
      });
      const inbox = Inbox.InboxService.of({
        list: () => Effect.succeed([]),
        get: () => Effect.succeed(null),
        mutate: () => Effect.die("Not used"),
        drain: Effect.void,
        drainAnalysis: Effect.void,
        ingest: () => Ref.update(ingested, (n) => n + 1),
      });
      const settingsLayer = Settings.layerTest();
      const layer = Sources.layer.pipe(
        Layer.provide(
          Layer.succeed(Linear.LinearConnection, {
            request: () => Effect.succeed({ configured: false, connection: null }),
            begin: () => Effect.die("Not used"),
            complete: () => Effect.void,
            cancel: () => Effect.void,
            disconnect: () => Effect.void,
            prepareMigration: () => Effect.die("Not used"),
            importMigration: () => Effect.void,
            read: () => Effect.succeed([]),
          }),
        ),
        Layer.provide(
          Layer.succeed(Superhuman.SuperhumanConnection, {
            begin: () => Effect.die("Not used"),
            complete: () => Effect.die("Not used"),
            disconnect: () => Effect.void,
            read: () => Effect.succeed([]),
            catalog: () => Effect.succeed({ accounts: [], splits: [], labels: [] }),
          }),
        ),
        Layer.provide(Sqlite.layerMemory),
        Layer.provideMerge(settingsLayer),
        Layer.provide(Layer.succeed(Secrets.ServerSecretStore, secrets)),
        Layer.provide(Layer.succeed(Transport.InboxSourceTransport, transport)),
        Layer.provide(Layer.succeed(Inbox.InboxService, inbox)),
      );
      yield* Effect.gen(function* () {
        const service = yield* Sources.InboxSources;
        const settings = yield* Settings.ServerSettingsService;
        const projectId = ProjectId.make("one");
        const input = {
          projectId,
          source: "slack" as const,
          enabled: true,
          categories: ["dms"],
          token: Redacted.make("xoxp-fixture-not-a-real-credential"),
        };
        yield* service.configure(input);
        yield* service.refresh(input);
        assert.equal(yield* Ref.get(calls), 0);
        const foreign = yield* service.list(ProjectId.make("two"));
        assert.equal(foreign[0]?.connected, false);
        yield* settings.updateSettings({
          projectSettingsOverrides: { [projectId]: { inboxEnabled: true } },
        });
        const synced = yield* service.refresh(input);
        assert.ok(synced.lastSyncAt);
        assert.equal(yield* Ref.get(ingested), 1);
        assert.equal(yield* Ref.get(calls), 1);
        yield* Ref.set(fail, true);
        const { token: _token, ...withoutToken } = input;
        yield* service.configure(withoutToken);
        const failed = yield* service.refresh(input);
        assert.equal(failed.lastSyncAt, synced.lastSyncAt);
        assert.equal(failed.error, "Slack permission missing");
        assert.ok(failed.retryAt);
        yield* service.disconnect(input);
        assert.equal(credentials.size, 0);
        assert.equal((yield* service.list(projectId))[0]?.connected, false);
        assert.equal(
          (yield* Effect.result(service.configure({ ...input, categories: ["saved"] })))._tag,
          "Failure",
        );
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped),
);
