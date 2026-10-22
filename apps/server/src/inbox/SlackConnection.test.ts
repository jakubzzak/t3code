import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { ProjectId } from "@t3tools/contracts";
import * as Secrets from "../auth/ServerSecretStore.ts";
import * as Settings from "../serverSettings.ts";
import * as Slack from "./SlackConnection.ts";

const project = ProjectId.make("project");
const other = ProjectId.make("other");
const setup = Effect.sync(() => {
  const values = new Map<string, Uint8Array>();
  const requests: Array<{ url: string; body: string }> = [];
  let response: unknown = {
    ok: true,
    team: { id: "T1", name: "Sample team" },
    authed_user: {
      id: "U1",
      access_token: "fixture-user-token",
      refresh_token: "fixture-refresh",
      expires_in: 3600,
    },
  };
  const secrets = Secrets.ServerSecretStore.of({
    get: (key) => Effect.sync(() => Option.fromUndefinedOr(values.get(key))),
    set: (key, value) =>
      Effect.sync(() => {
        values.set(key, value);
      }),
    create: () => Effect.die("Not used"),
    remove: (key) =>
      Effect.sync(() => {
        values.delete(key);
      }),
    getOrCreateRandom: () => Effect.die("Not used"),
  });
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push({
        url: request.url,
        body: request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
      });
      return HttpClientResponse.fromWeb(
        request,
        new Response(JSON.stringify(response), { status: 200 }),
      );
    }),
  );
  const dependencies = Layer.mergeAll(
    Layer.succeed(Secrets.ServerSecretStore, secrets),
    Layer.succeed(HttpClient.HttpClient, client),
    Settings.layerTest({
      projectSettingsOverrides: { [project]: { slackClientId: "public-slack-client" } },
    }),
  );
  return {
    values,
    requests,
    setResponse: (next: unknown) => {
      response = next;
    },
    layer: Slack.layer.pipe(Layer.provide(dependencies)),
  };
});

it.effect(
  "uses project PKCE, grants only user read scopes, consumes callback state once and refreshes rotating tokens",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      yield* Effect.gen(function* () {
        const slack = yield* Slack.SlackConnection;
        assert.equal(
          (yield* Effect.result(slack.begin(other, "https://example.test")))._tag,
          "Failure",
        );
        const url = new URL(yield* slack.begin(project, "https://example.test"));
        assert.equal(url.searchParams.get("client_id"), "public-slack-client");
        assert.equal(url.searchParams.get("code_challenge_method"), "S256");
        assert.equal(
          url.searchParams.get("redirect_uri"),
          "https://example.test/oauth/inbox/slack/callback",
        );
        assert.isFalse(url.searchParams.has("scope"));
        assert.isFalse(url.searchParams.has("client_secret"));
        assert.notInclude(url.searchParams.get("user_scope")!, "write");
        assert.equal(fixture.values.size, 0);
        const state = url.searchParams.get("state")!;
        assert.equal((yield* Effect.result(slack.complete("unknown", "code")))._tag, "Failure");
        const connected = yield* slack.complete(state, "code");
        assert.deepEqual(connected, { projectId: project, account: "Sample team · U1" });
        assert.equal(yield* slack.accessToken(project), "fixture-user-token");
        assert.equal((yield* Effect.result(slack.accessToken(other)))._tag, "Failure");
        assert.equal((yield* Effect.result(slack.complete(state, "code")))._tag, "Failure");
        const body = new URLSearchParams(fixture.requests[0]!.body);
        assert.equal(body.get("client_id"), "public-slack-client");
        assert.equal(body.get("code"), "code");
        assert.isFalse(body.has("client_secret"));
        assert.equal(body.get("code_verifier")?.length, 43);
        fixture.setResponse({
          ok: true,
          access_token: "fixture-refreshed",
          refresh_token: "fixture-next-refresh",
          expires_in: 3600,
        });
        yield* TestClock.adjust("60 minutes");
        assert.equal(yield* slack.accessToken(project), "fixture-refreshed");
        assert.equal(
          new URLSearchParams(fixture.requests[1]!.body).get("refresh_token"),
          "fixture-refresh",
        );
        yield* slack.disconnect(project);
        assert.equal(fixture.values.size, 0);
        assert.equal((yield* Effect.result(slack.accessToken(project)))._tag, "Failure");
      }).pipe(Effect.provide(fixture.layer));
    }),
);
it.effect(
  "cancels and expires sign-in, replaces previous pending attempts, and refuses bot-only grants",
  () =>
    Effect.gen(function* () {
      const fixture = yield* setup;
      yield* Effect.gen(function* () {
        const slack = yield* Slack.SlackConnection;
        const begin = () =>
          slack
            .begin(project, "https://example.test")
            .pipe(Effect.map((url) => new URL(url).searchParams.get("state")!));
        const cancelled = yield* begin();
        yield* slack.cancel(project);
        assert.equal((yield* Effect.result(slack.complete(cancelled, "code")))._tag, "Failure");
        const replaced = yield* begin();
        const expired = yield* begin();
        assert.equal((yield* Effect.result(slack.complete(replaced, "code")))._tag, "Failure");
        yield* TestClock.adjust("16 minutes");
        assert.equal((yield* Effect.result(slack.complete(expired, "code")))._tag, "Failure");
        assert.equal(fixture.requests.length, 0);
        fixture.setResponse({
          ok: true,
          access_token: "bot-token",
          team: { id: "T1", name: "Sample" },
        });
        assert.equal(
          (yield* Effect.result(slack.complete(yield* begin(), "code")))._tag,
          "Failure",
        );
        assert.equal(fixture.values.size, 0);
        fixture.values.set(
          "inbox-slack-project",
          new TextEncoder().encode("xoxp-existing-fixture"),
        );
        assert.equal(yield* slack.accessToken(project), "xoxp-existing-fixture");
      }).pipe(Effect.provide(fixture.layer));
    }),
);
