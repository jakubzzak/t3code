import { assert, it } from "@effect/vitest";
import { vi } from "vite-plus/test";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { ProjectId } from "@t3tools/contracts";
import * as Secrets from "../auth/ServerSecretStore.ts";
import * as Connection from "./SuperhumanConnection.ts";

vi.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({
  auth: async (provider: OAuthClientProvider, options: { authorizationCode?: string }) => {
    if (options.authorizationCode) {
      if (options.authorizationCode === "bad") throw new Error("Rejected code");
      await provider.codeVerifier();
      await provider.saveTokens({ access_token: "fixture-token", token_type: "Bearer" });
      return "AUTHORIZED";
    }
    await provider.saveClientInformation?.({ client_id: "fixture-client" });
    await provider.saveCodeVerifier("fixture-verifier");
    const url = new URL("https://authorization.example/authorize");
    url.searchParams.set("state", await provider.state!());
    await provider.redirectToAuthorization(url);
    return "REDIRECT";
  },
}));
const projectId = ProjectId.make("one");
it.effect(
  "stages sign-in, rejects replay and expiry, and preserves the prior connection on cancellation or failure",
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
      yield* Effect.gen(function* () {
        const connection = yield* Connection.SuperhumanConnection;
        const state = (url: string) => new URL(url).searchParams.get("state")!;
        const first = state(yield* connection.begin(projectId, "https://environment.example"));
        assert.equal(values.size, 0);
        assert.equal(yield* connection.complete(first, "valid"), projectId);
        const established = [...values.values()][0];
        assert.ok(established);
        assert.equal((yield* Effect.result(connection.complete(first, "valid")))._tag, "Failure");
        const cancelled = state(yield* connection.begin(projectId, "https://environment.example"));
        assert.equal([...values.values()][0], established);
        const next = state(yield* connection.begin(projectId, "https://environment.example"));
        assert.equal(
          (yield* Effect.result(connection.complete(cancelled, "valid")))._tag,
          "Failure",
        );
        assert.equal((yield* Effect.result(connection.complete(next, "bad")))._tag, "Failure");
        assert.equal([...values.values()][0], established);
        const expired = state(yield* connection.begin(projectId, "https://environment.example"));
        yield* TestClock.adjust("16 minutes");
        assert.equal((yield* Effect.result(connection.complete(expired, "valid")))._tag, "Failure");
        const disconnected = state(
          yield* connection.begin(projectId, "https://environment.example"),
        );
        yield* connection.disconnect(projectId);
        assert.equal(values.size, 0);
        assert.equal(
          (yield* Effect.result(connection.complete(disconnected, "valid")))._tag,
          "Failure",
        );
      }).pipe(
        Effect.provide(Connection.layer),
        Effect.provide(Layer.succeed(Secrets.ServerSecretStore, secrets)),
        Effect.provide(NodeCrypto.layer),
      );
    }),
);
