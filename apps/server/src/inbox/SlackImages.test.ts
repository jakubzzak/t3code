import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as Linear from "../linear/LinearConnection.ts";
import * as Superhuman from "./SuperhumanConnection.ts";
import * as Transport from "./InboxSourceTransport.ts";

it.effect.each(["image", "foreign", "redirect", "wrong-account", "html", "too-large"] as const)(
  "loads Slack images with bounded authenticated requests: %s",
  (scenario) => {
    const requests: string[] = [];
    const url =
      scenario === "foreign"
        ? "https://files.slack.com.attacker.test/image.png"
        : "https://files.slack.com/files-pri/T-F/image.png";
    const http = HttpClient.make((request) =>
      Effect.sync(() => {
        requests.push(request.url);
        assert.equal(request.headers.authorization, "Bearer fixture-token");
        if (request.url.endsWith("auth.test"))
          return HttpClientResponse.fromWeb(
            request,
            Response.json({
              ok: true,
              team_id: "T1",
              user_id: scenario === "wrong-account" ? "U2" : "U1",
            }),
          );
        return HttpClientResponse.fromWeb(
          request,
          scenario === "redirect"
            ? new Response(null, {
                status: 302,
                headers: { location: "https://example.com/image.png" },
              })
            : new Response(
                scenario === "too-large"
                  ? new Uint8Array(10 * 1024 * 1024 + 1)
                  : new Uint8Array([1, 2, 3]),
                { headers: { "content-type": scenario === "html" ? "text/html" : "image/png" } },
              ),
        );
      }),
    );
    return Effect.gen(function* () {
      const result = yield* (yield* Transport.InboxSourceTransport)
        .readImage("fixture-token", url, "T1:U1")
        .pipe(Effect.result);
      assert.equal(result._tag, scenario === "image" ? "Success" : "Failure");
      assert.equal(
        requests.length,
        scenario === "foreign" ? 0 : scenario === "wrong-account" ? 1 : 2,
      );
      if (result._tag === "Success")
        assert.deepEqual(result.success, {
          bytes: new Uint8Array([1, 2, 3]),
          mimeType: "image/png",
        });
    }).pipe(
      Effect.provide(
        Transport.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(HttpClient.HttpClient, http),
              Layer.mock(Linear.LinearConnection)({}),
              Layer.mock(Superhuman.SuperhumanConnection)({}),
            ),
          ),
        ),
      ),
    );
  },
);
