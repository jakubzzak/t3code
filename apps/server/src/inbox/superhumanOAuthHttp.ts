import type { InboxError } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { InboxSources } from "./InboxSources.ts";
import { SLACK_CALLBACK_PATH } from "./SlackConnection.ts";
import { SUPERHUMAN_CALLBACK_PATH } from "./SuperhumanConnection.ts";
const headers = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const sources = yield* InboxSources;
    const callback = (
      name: string,
      complete: (state: string, code: string) => Effect.Effect<void, InboxError>,
    ) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const params = new URL(request.url, "http://localhost").searchParams;
        const code = params.get("code");
        const state = params.get("state");
        if (!code || !state || params.has("error"))
          return HttpServerResponse.text(
            "Authorization was cancelled or incomplete. Return to Blackbird Integrations and connect again.",
            { status: 400, headers },
          );
        const result = yield* complete(state, code).pipe(Effect.result);
        return HttpServerResponse.text(
          result._tag === "Success"
            ? `${name} connected. Return to Blackbird Integrations to configure its notification sources.`
            : result.failure.detail,
          { status: result._tag === "Success" ? 200 : 400, headers },
        );
      });
    return Layer.mergeAll(
      HttpRouter.add("GET", SLACK_CALLBACK_PATH, callback("Slack", sources.completeSlack)),
      HttpRouter.add(
        "GET",
        SUPERHUMAN_CALLBACK_PATH,
        callback("Superhuman", sources.completeSuperhuman),
      ),
    );
  }),
);
