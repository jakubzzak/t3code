import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";
import { LinearConnection, LINEAR_CALLBACK_PATH } from "./LinearConnection.ts";
const headers = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
};
export const layer = Layer.unwrap(
  Effect.gen(function* () {
    const connection = yield* LinearConnection;
    return HttpRouter.add(
      "GET",
      LINEAR_CALLBACK_PATH,
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const params = new URL(request.url, "http://localhost").searchParams;
        const state = params.get("state");
        const code = params.get("code");
        if (!state || !code || params.has("error"))
          return HttpServerResponse.text(
            "Linear sign-in was cancelled or incomplete. Return to Integrations and connect again.",
            { status: 400, headers },
          );
        const result = yield* connection.complete(state, code).pipe(Effect.result);
        return HttpServerResponse.text(
          result._tag === "Success"
            ? "Linear connected. Return to Blackbird Integrations."
            : result.failure.detail,
          { status: result._tag === "Success" ? 200 : 400, headers },
        );
      }),
    );
  }),
);
