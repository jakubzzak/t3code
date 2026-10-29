import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { CommandId, ProjectId } from "@t3tools/contracts";
import * as Slack from "./SlackConnection.ts";
import * as Linear from "../linear/LinearConnection.ts";
import * as Transport from "./InboxReplyTransport.ts";

const input = {
  projectId: ProjectId.make("p"),
  id: "notification",
  itemId: "message",
  commandId: CommandId.make("reply"),
  target: { source: "slack" as const, channelId: "D1", threadTs: "1793260800.000001" },
  text: "Friday works.",
};

it.effect(
  "posts exactly to the original Slack thread as the verified user, without broadcasting",
  () => {
    const posts: unknown[] = [];
    const http = HttpClient.make((request) =>
      Effect.sync(() => {
        if (request.url.endsWith("auth.test"))
          return HttpClientResponse.fromWeb(
            request,
            Response.json(
              { ok: true, team_id: "T1", user_id: "U1" },
              { headers: { "x-oauth-scopes": "im:read,chat:write" } },
            ),
          );
        if (request.body._tag === "Uint8Array")
          posts.push(JSON.parse(new TextDecoder().decode(request.body.body)));
        return HttpClientResponse.fromWeb(
          request,
          Response.json({ ok: true, ts: "1793260900.000001", message: { text: "Friday works." } }),
        );
      }),
    );
    return Effect.gen(function* () {
      const transport = yield* Transport.InboxReplyTransport;
      const result = yield* transport.send(input, "T1:U1");
      assert.equal(result.id, "1793260900.000001");
      assert.deepEqual(posts, [
        {
          channel: "D1",
          thread_ts: input.target.threadTs,
          text: input.text,
          reply_broadcast: false,
          unfurl_links: false,
          unfurl_media: false,
        },
      ]);
    }).pipe(
      Effect.provide(
        Transport.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.mock(Slack.SlackConnection)({
                accessToken: () => Effect.succeed("fixture-token"),
              }),
              Layer.mock(Linear.LinearConnection)({}),
              Layer.succeed(HttpClient.HttpClient, http),
            ),
          ),
        ),
      ),
    );
  },
);

it.effect.each([
  ["im:read", "T1:U1", 200, "permission"],
  ["chat:write", "T2:U2", 200, "permission"],
  ["chat:write", "T1:U1", 429, "rate-limit"],
  ["chat:write", "T1:U1", 503, "uncertain"],
] as const)("handles grant/account/status %s %s %s as %s", ([scopes, account, status, reason]) => {
  let posts = 0;
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      if (request.url.endsWith("auth.test"))
        return HttpClientResponse.fromWeb(
          request,
          Response.json(
            { ok: true, team_id: "T1", user_id: "U1" },
            { headers: { "x-oauth-scopes": scopes } },
          ),
        );
      posts++;
      return HttpClientResponse.fromWeb(
        request,
        Response.json({}, { status, headers: { "retry-after": "17" } }),
      );
    }),
  );
  return Effect.gen(function* () {
    const result = yield* (yield* Transport.InboxReplyTransport)
      .send(input, account)
      .pipe(Effect.result);
    assert.equal(result._tag, "Failure");
    if (result._tag === "Failure") {
      assert.equal(result.failure.reason, reason);
      if (reason === "rate-limit") assert.equal(result.failure.retryAfter, 17);
    }
    assert.equal(posts, reason === "permission" ? 0 : 1);
  }).pipe(
    Effect.provide(
      Transport.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(Slack.SlackConnection)({
              accessToken: () => Effect.succeed("fixture-token"),
            }),
            Layer.mock(Linear.LinearConnection)({}),
            Layer.succeed(HttpClient.HttpClient, http),
          ),
        ),
      ),
    ),
  );
});
