import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { InboxSources } from "./InboxSources.ts";
import { SUPERHUMAN_CALLBACK_PATH } from "./SuperhumanConnection.ts";
const headers = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const sources = yield* InboxSources;
    return HttpRouter.add(
      "GET",
      SUPERHUMAN_CALLBACK_PATH,
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
        const result = yield* sources.completeSuperhuman(state, code).pipe(Effect.result);
        return HttpServerResponse.text(
          result._tag === "Success"
            ? "Superhuman connected. Return to Blackbird Integrations to select accounts, splits and labels."
            : result.failure.detail,
          { status: result._tag === "Success" ? 200 : 400, headers },
        );
      }),
    );
  }),
);
