import * as FileSystem from "effect/FileSystem";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as ServerConfig from "../config.ts";
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
            ServerConfig.layerTest(process.cwd(), { prefix: "t3-inbox-image-test-" }).pipe(
              Layer.provide(NodeServices.layer),
            ),
          ),
          Layer.provide(NodeServices.layer),
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
          ServerConfig.layerTest(process.cwd(), { prefix: "t3-inbox-image-test-" }).pipe(
            Layer.provide(NodeServices.layer),
          ),
        ),
        Layer.provide(NodeServices.layer),
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

it.effect.each([
  "caption",
  "image-only",
  "metadata-missing",
  "lost-completion",
  "missing-scope",
  "foreign-upload",
  "invalid-image",
] as const)("uploads images through Slack's external upload flow: %s", (scenario) => {
  const requests: Array<{ url: string; authorization: string | undefined; body: unknown }> = [];
  const png = Uint8Array.from(
    atob(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
    ),
    (char) => char.charCodeAt(0),
  );
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const upload = request.url.startsWith("https://files.slack.com/upload/");
      const body =
        request.body._tag === "Uint8Array"
          ? upload
            ? request.body.body
            : JSON.parse(new TextDecoder().decode(request.body.body))
          : null;
      requests.push({ url: request.url, authorization: request.headers.authorization, body });
      if (request.url.endsWith("auth.test"))
        return HttpClientResponse.fromWeb(
          request,
          Response.json(
            { ok: true, team_id: "T1", user_id: "U1" },
            {
              headers: {
                "x-oauth-scopes":
                  scenario === "missing-scope" ? "chat:write" : "chat:write,files:write",
              },
            },
          ),
        );
      if (request.url.endsWith("files.getUploadURLExternal"))
        return HttpClientResponse.fromWeb(
          request,
          Response.json({
            ok: true,
            file_id: "F1",
            upload_url:
              scenario === "foreign-upload"
                ? "https://example.com/upload"
                : "https://files.slack.com/upload/v1/test",
          }),
        );
      if (upload) return HttpClientResponse.fromWeb(request, new Response("OK"));
      if (request.url.endsWith("files.completeUploadExternal"))
        return HttpClientResponse.fromWeb(
          request,
          scenario === "lost-completion"
            ? new Response("", { status: 503 })
            : Response.json({ ok: true, files: [{ id: "F1" }] }),
        );
      if (scenario === "metadata-missing" && request.url.endsWith("files.info"))
        return HttpClientResponse.fromWeb(
          request,
          Response.json({ ok: false, error: "file_not_found" }),
        );
      if (request.url.endsWith("files.info"))
        return HttpClientResponse.fromWeb(
          request,
          Response.json({
            file: {
              id: "F1",
              title: "shot.png",
              mimetype: "image/png",
              url_private: "https://files.slack.com/files-pri/T1-F1/shot.png",
              shares: {
                private: { D1: [{ ts: "1793260900.000001", thread_ts: input.target.threadTs }] },
              },
            },
          }),
        );
      throw new Error("Unexpected request");
    }),
  );
  const dependencies = ServerConfig.layerTest(process.cwd(), { prefix: "t3-slack-upload-" }).pipe(
    Layer.provideMerge(NodeServices.layer),
  );
  const layer = Transport.layer.pipe(
    Layer.provideMerge(dependencies),
    Layer.provide(
      Layer.mergeAll(
        Layer.mock(Slack.SlackConnection)({ accessToken: () => Effect.succeed("fixture-token") }),
        Layer.mock(Linear.LinearConnection)({}),
        Layer.succeed(HttpClient.HttpClient, http),
      ),
    ),
  );
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* ServerConfig.ServerConfig;
    const attachmentId = "pending-11111111-1111-4111-8111-111111111111";
    yield* fs.makeDirectory(config.attachmentsDir, { recursive: true });
    yield* fs.writeFile(
      `${config.attachmentsDir}/${attachmentId}.png`,
      scenario === "invalid-image" ? new Uint8Array(png.length) : png,
    );
    const result = yield* (yield* Transport.InboxReplyTransport)
      .send(
        {
          ...input,
          text: scenario === "image-only" ? "" : input.text,
          images: [
            { attachmentId, name: "shot.png", mimeType: "image/png", sizeBytes: png.length },
          ],
        },
        "T1:U1",
      )
      .pipe(Effect.result);
    if (["caption", "image-only", "metadata-missing"].includes(scenario)) {
      assert.equal(result._tag, "Success");
      if (result._tag === "Success" && scenario === "metadata-missing")
        assert.deepEqual(result.success.images, [{ id: "F1", name: "shot.png" }]);
      assert.deepEqual(
        requests.find((entry) => entry.url.endsWith("files.completeUploadExternal"))?.body,
        {
          files: [{ id: "F1", title: "shot.png" }],
          channel_id: "D1",
          thread_ts: input.target.threadTs,
          ...(scenario !== "image-only" ? { initial_comment: input.text } : {}),
        },
      );
    } else {
      assert.equal(result._tag, "Failure");
      if (result._tag === "Failure")
        assert.equal(
          result.failure.reason,
          scenario === "missing-scope"
            ? "permission"
            : scenario === "lost-completion"
              ? "uncertain"
              : "rejected",
        );
    }
    assert.equal(requests.filter((entry) => entry.url.endsWith("chat.postMessage")).length, 0);
    for (const request of requests.filter((entry) =>
      entry.url.startsWith("https://files.slack.com"),
    )) {
      assert.equal(request.authorization, undefined);
      assert.deepEqual(request.body, png);
    }
    assert.equal(
      requests.some((entry) => entry.url.startsWith("https://example.com")),
      false,
    );
    if (scenario === "missing-scope" || scenario === "invalid-image")
      assert.equal(requests.length, 1);
  }).pipe(Effect.provide(layer));
});
