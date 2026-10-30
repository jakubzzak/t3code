import { assert, it } from "@effect/vitest";
import { CommandId, ProjectId, type SlackSendInput } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as SqlClient from "effect/sql/SqlClient";
import * as Connection from "./SlackConnection.ts";
import * as Slack from "./SlackService.ts";
import * as Sqlite from "../persistence/Sqlite.ts";

const input: SlackSendInput = {
  projectId: ProjectId.make("p"),
  commandId: CommandId.make("send"),
  connectionId: "T1:U1",
  destination: { userIds: ["U2"] },
  text: "Reviewed message",
};

const fixture = (
  options: {
    scopes?: string;
    account?: string;
    postStatus?: number;
    postBody?: unknown;
    openStatus?: number;
    afterPost?: Effect.Effect<void>;
  } = {},
) => {
  const requests: {
    method: string;
    body: unknown;
    url: string;
    parameters: Record<string, string>;
  }[] = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      assert.equal(request.headers.authorization, "Bearer fixture-token");
      const method = new URL(request.url).pathname.split("/").at(-1)!;
      const body =
        request.body._tag === "Uint8Array"
          ? JSON.parse(new TextDecoder().decode(request.body.body))
          : undefined;
      requests.push({
        method,
        body,
        url: request.url,
        parameters: Object.fromEntries(request.urlParams),
      });
      const data =
        method === "auth.test"
          ? { ok: true, team_id: "T1", user_id: options.account ?? "U1" }
          : method === "conversations.open"
            ? { ok: true, channel: { id: "D1" } }
            : method === "chat.postMessage"
              ? (options.postBody ?? { ok: true, channel: "D1", ts: "1793260900.000001" })
              : {
                  ok: true,
                  members: [{ id: "U2", real_name: "Alex" }],
                  response_metadata: { next_cursor: "next" },
                };
      return HttpClientResponse.fromWeb(
        request,
        Response.json(data, {
          status:
            method === "chat.postMessage"
              ? (options.postStatus ?? 200)
              : method === "conversations.open"
                ? (options.openStatus ?? 200)
                : 200,
          headers: {
            "x-oauth-scopes": options.scopes ?? "chat:write,im:write,mpim:write,users:read",
            "retry-after": "12",
          },
        }),
      );
    }).pipe(
      Effect.tap(() =>
        request.url.endsWith("chat.postMessage") ? (options.afterPost ?? Effect.void) : Effect.void,
      ),
    ),
  );
  const service = Slack.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(HttpClient.HttpClient, http),
        Layer.mock(Connection.SlackConnection)({
          accessToken: (projectId) => {
            assert.equal(projectId, input.projectId);
            return Effect.succeed("fixture-token");
          },
        }),
      ),
    ),
  );
  return { requests, service, layer: service.pipe(Layer.provideMerge(Sqlite.layerMemory)) };
};

it.effect.each([
  { destination: { userIds: ["U2"] }, threadTs: undefined },
  { destination: { userIds: ["U2", "U3"] }, threadTs: undefined },
  { destination: { channelId: "C1" }, threadTs: undefined },
  { destination: { channelId: "G1" }, threadTs: "1793260800.000001" },
  { destination: { channelId: "D1" }, threadTs: undefined },
])("sends independently of Inbox to %j", (target) => {
  const f = fixture();
  return Effect.gen(function* () {
    const slack = yield* Slack.SlackService;
    const result = yield* slack.send({
      ...input,
      destination: target.destination,
      ...(target.threadTs ? { threadTs: target.threadTs } : {}),
    });
    assert.equal(result.status, "sent");
    const opening = f.requests.find((request) => request.method === "conversations.open");
    if ("userIds" in target.destination)
      assert.deepEqual(opening?.body, {
        users: target.destination.userIds.join(","),
        return_im: true,
      });
    else assert.isUndefined(opening);
    const channel = "channelId" in target.destination ? target.destination.channelId : "D1";
    assert.deepEqual(f.requests.at(-1)?.body, {
      channel,
      text: input.text,
      ...(target.threadTs ? { thread_ts: target.threadTs } : {}),
      reply_broadcast: false,
      unfurl_links: false,
      unfurl_media: false,
    });
  }).pipe(Effect.provide(f.layer));
});

it.effect.each([{ scopes: "im:write" }, { scopes: "chat:write" }, { account: "U9" }])(
  "rejects missing scope or changed account before opening or posting: %j",
  (options) => {
    const f = fixture(options);
    return Effect.gen(function* () {
      const result = yield* (yield* Slack.SlackService).send(input);
      assert.equal(result.status, "failed");
      assert.include(result.error!, "permission or account changed");
      assert.deepEqual(
        f.requests.map((request) => request.method),
        ["auth.test"],
      );
    }).pipe(Effect.provide(f.layer));
  },
);

it.effect("requires mpim:write to open a group DM", () => {
  const f = fixture({ scopes: "chat:write,im:write" });
  return Effect.gen(function* () {
    const result = yield* (yield* Slack.SlackService).send({
      ...input,
      destination: { userIds: ["U2", "U3"] },
    });
    assert.equal(result.status, "failed");
    assert.lengthOf(f.requests, 1);
  }).pipe(Effect.provide(f.layer));
});

it.effect.each([
  { postStatus: 429, status: "failed", retryAfter: 12 },
  { postStatus: 503, status: "uncertain", retryAfter: undefined },
  { postStatus: 408, status: "uncertain", retryAfter: undefined },
  { postBody: { ok: false, error: "internal_error" }, status: "uncertain", retryAfter: undefined },
  { postBody: { ok: false, error: "channel_not_found" }, status: "failed", retryAfter: undefined },
  { postBody: { ok: true }, status: "uncertain", retryAfter: undefined },
  { postBody: { ok: false, error: "missing_scope" }, status: "failed", retryAfter: undefined },
])("records the delivery outcome without reposting: %j", (options) => {
  const f = fixture(options);
  return Effect.gen(function* () {
    const slack = yield* Slack.SlackService;
    const result = yield* slack.send(input);
    assert.equal(result.status, options.status);
    assert.equal(result.retryAfter, options.retryAfter);
    assert.deepEqual(yield* slack.send(input), result);
    assert.lengthOf(
      f.requests.filter((request) => request.method === "chat.postMessage"),
      1,
    );
  }).pipe(Effect.provide(f.layer));
});

it.effect(
  "retains a successful receipt across service restarts and rejects changed retries",
  () => {
    const f = fixture();
    return Effect.gen(function* () {
      const result = yield* Slack.SlackService.use((slack) => slack.send(input)).pipe(
        Effect.provide(f.service),
      );
      const resumed = yield* Slack.SlackService.use((slack) => slack.send(input)).pipe(
        Effect.provide(f.service),
      );
      assert.deepEqual(resumed, result);
      const changed = yield* Slack.SlackService.use((slack) =>
        slack.send({ ...input, text: "Different" }),
      ).pipe(Effect.provide(f.service), Effect.flip);
      assert.equal(changed.reason, "conflict");
      assert.lengthOf(
        f.requests.filter((request) => request.method === "chat.postMessage"),
        1,
      );
    }).pipe(Effect.provide(Sqlite.layerMemory));
  },
);

it.effect("claims an attempt atomically while a concurrent caller checks it", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const slack = yield* Slack.SlackService;
    const waiting = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let checks = 0;
    const check = Effect.suspend(() =>
      ++checks === 2
        ? Deferred.succeed(waiting, undefined).pipe(Effect.andThen(Deferred.await(release)))
        : Effect.void,
    );
    const first = yield* slack.send(input, check).pipe(Effect.forkChild);
    yield* Deferred.await(waiting);
    assert.equal((yield* slack.send(input)).status, "pending");
    yield* Deferred.succeed(release, undefined);
    assert.equal((yield* Fiber.join(first)).status, "sent");
    assert.lengthOf(
      f.requests.filter((request) => request.method === "chat.postMessage"),
      1,
    );
  }).pipe(Effect.provide(f.layer));
});

it.effect("preserves the pending receipt when saving a successful response fails", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`CREATE TRIGGER fail_receipt BEFORE UPDATE ON slack_send_attempts BEGIN SELECT RAISE(FAIL, 'fixture'); END`;
    const slack = yield* Slack.SlackService;
    assert.equal((yield* slack.send(input).pipe(Effect.flip)).reason, "storage");
    assert.equal((yield* slack.send(input)).status, "pending");
    assert.lengthOf(
      f.requests.filter((request) => request.method === "chat.postMessage"),
      1,
    );
  }).pipe(Effect.provide(f.layer));
});

it.effect("reads bounded user context with pagination and rejects mutating methods", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const slack = yield* Slack.SlackService;
    const data = yield* slack.read({
      projectId: input.projectId,
      method: "users.list",
      parameters: { limit: "1000", cursor: "previous" },
    });
    assert.deepEqual(data.response_metadata, { next_cursor: "next" });
    assert.deepEqual(f.requests[0]?.parameters, { limit: "100", cursor: "previous" });
    // Exercise the service boundary with runtime input that bypasses TypeScript.
    const invalid = yield* slack
      .read(JSON.parse('{"projectId":"p","method":"chat.postMessage","parameters":{}}'))
      .pipe(Effect.flip);
    assert.equal(invalid.reason, "rejected");
    assert.equal(
      (yield* slack
        .read({
          projectId: input.projectId,
          method: "auth.test",
          parameters: { token: "untrusted" },
        })
        .pipe(Effect.flip)).reason,
      "rejected",
    );
    assert.lengthOf(f.requests, 1);
  }).pipe(Effect.provide(f.layer));
});

it.effect("rechecks authorization after opening a DM and never posts after revocation", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const slack = yield* Slack.SlackService;
    let checks = 0;
    const check = Effect.suspend(() => (++checks === 3 ? Effect.fail("revoked") : Effect.void));
    assert.equal(yield* slack.send(input, check).pipe(Effect.flip), "revoked");
    assert.deepEqual(
      f.requests.map((request) => request.method),
      ["auth.test", "conversations.open"],
    );
    assert.equal((yield* slack.send(input)).status, "pending");
  }).pipe(Effect.provide(f.layer));
});

it.effect("does not post when opening a DM is rate limited", () => {
  const f = fixture({ openStatus: 429 });
  return Effect.gen(function* () {
    const result = yield* (yield* Slack.SlackService).send(input);
    assert.equal(result.status, "failed");
    assert.equal(result.retryAfter, 12);
    assert.isFalse(f.requests.some((request) => request.method === "chat.postMessage"));
  }).pipe(Effect.provide(f.layer));
});

it.effect("sends reviewed Block Kit content with fallback text", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const blocks = [{ type: "section", text: { type: "mrkdwn", text: "*Reviewed message*" } }];
    assert.equal((yield* (yield* Slack.SlackService).send({ ...input, blocks })).status, "sent");
    assert.deepEqual(f.requests.at(-1)?.body, {
      channel: "D1",
      text: input.text,
      blocks,
      reply_broadcast: false,
      unfurl_links: false,
      unfurl_media: false,
    });
  }).pipe(Effect.provide(f.layer));
});

it.effect("preserves the exact reviewed text including indentation and trailing newlines", () => {
  const f = fixture();
  return Effect.gen(function* () {
    const text = "\n  keep this indentation  \n";
    assert.equal((yield* (yield* Slack.SlackService).send({ ...input, text })).status, "sent");
    assert.propertyVal(f.requests.at(-1)?.body, "text", text);
  }).pipe(Effect.provide(f.layer));
});

it.effect("does not expose a malformed Slack payload in a persisted uncertain receipt", () => {
  const f = fixture({ postBody: { ok: true, channel: "D1", ts: "fixture-private-response" } });
  return Effect.gen(function* () {
    const slack = yield* Slack.SlackService;
    const receipt = yield* slack.send(input);
    assert.equal(receipt.status, "uncertain");
    assert.notInclude(JSON.stringify(receipt), "fixture-private-response");
    assert.notInclude(JSON.stringify(yield* slack.send(input)), "fixture-private-response");
  }).pipe(Effect.provide(f.layer));
});

it.effect.each([
  { destination: { channelId: "C2" } },
  { projectId: ProjectId.make("another-project") },
  { connectionId: "T2:U1" },
  { threadTs: "1793260800.000001" },
  { text: `${input.text} ` },
])("binds the command ID to the reviewed request: %j", (change) => {
  const f = fixture();
  return Effect.gen(function* () {
    const slack = yield* Slack.SlackService;
    assert.equal((yield* slack.send(input)).status, "sent");
    assert.equal((yield* slack.send({ ...input, ...change }).pipe(Effect.flip)).reason, "conflict");
    assert.lengthOf(
      f.requests.filter((request) => request.method === "chat.postMessage"),
      1,
    );
  }).pipe(Effect.provide(f.layer));
});

it.effect("does not resend an interrupted post after reconstructing the service", () =>
  Effect.gen(function* () {
    const accepted = yield* Deferred.make<void>();
    const response = yield* Deferred.make<void>();
    const f = fixture({
      afterPost: Deferred.succeed(accepted, undefined).pipe(
        Effect.andThen(Deferred.await(response)),
      ),
    });
    const first = yield* Slack.SlackService.use((slack) => slack.send(input)).pipe(
      Effect.provide(f.service),
      Effect.forkChild,
    );
    yield* Deferred.await(accepted);
    yield* Fiber.interrupt(first);
    const receipt = yield* Slack.SlackService.use((slack) => slack.send(input)).pipe(
      Effect.provide(f.service),
    );
    assert.equal(receipt.status, "pending");
    assert.lengthOf(
      f.requests.filter((request) => request.method === "chat.postMessage"),
      1,
    );
  }).pipe(Effect.provide(Sqlite.layerMemory)),
);
