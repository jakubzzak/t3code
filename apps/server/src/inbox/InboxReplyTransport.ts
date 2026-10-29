import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as DateTime from "effect/DateTime";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { InboxReplyError, type InboxReplyInput, type InboxReplyMessage } from "@t3tools/contracts";
import * as Slack from "./SlackConnection.ts";
import * as Linear from "../linear/LinearConnection.ts";

export class InboxReplyTransport extends Context.Service<
  InboxReplyTransport,
  {
    readonly send: (
      input: InboxReplyInput,
      connectionId: string,
    ) => Effect.Effect<InboxReplyMessage, InboxReplyError>;
  }
>()("t3/inbox/InboxReplyTransport") {}

const Identity = Schema.Struct({
  ok: Schema.Boolean,
  team_id: Schema.String,
  user_id: Schema.String,
});
const Posted = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
  ts: Schema.optionalKey(Schema.String),
  message: Schema.optionalKey(Schema.Struct({ text: Schema.optionalKey(Schema.String) })),
});

const make = Effect.gen(function* () {
  const slack = yield* Slack.SlackConnection;
  const linear = yield* Linear.LinearConnection;
  const http = yield* HttpClient.HttpClient;
  return InboxReplyTransport.of({
    send: (input, connectionId) =>
      Effect.gen(function* () {
        if (input.target.source === "linear")
          return yield* linear.createComment(input.projectId, connectionId, {
            ...input.target,
            body: input.text,
          });
        const token = yield* slack
          .accessToken(input.projectId)
          .pipe(Effect.mapError(() => new InboxReplyError({ reason: "permission" })));
        // Verify the grant and account before posting, including manually entered legacy tokens.
        const identityResponse = yield* http
          .execute(
            HttpClientRequest.get("https://slack.com/api/auth.test").pipe(
              HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
            ),
          )
          .pipe(Effect.mapError(() => new InboxReplyError({ reason: "permission" })));
        if (identityResponse.status === 429)
          return yield* new InboxReplyError({
            reason: "rate-limit",
            retryAfter: Number(identityResponse.headers["retry-after"]) || 60,
          });
        const identity = yield* identityResponse.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Identity)),
          Effect.mapError(() => new InboxReplyError({ reason: "permission" })),
        );
        if (
          !identity.ok ||
          `${identity.team_id}:${identity.user_id}` !== connectionId ||
          !(identityResponse.headers["x-oauth-scopes"] ?? "")
            .split(",")
            .map((scope) => scope.trim())
            .includes("chat:write")
        )
          return yield* new InboxReplyError({ reason: "permission" });
        const response = yield* http
          .execute(
            HttpClientRequest.post("https://slack.com/api/chat.postMessage").pipe(
              HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
              HttpClientRequest.bodyJsonUnsafe({
                channel: input.target.channelId,
                thread_ts: input.target.threadTs,
                text: input.text,
                reply_broadcast: false,
                unfurl_links: false,
                unfurl_media: false,
              }),
            ),
          )
          .pipe(Effect.mapError(() => new InboxReplyError({ reason: "uncertain" })));
        if (response.status === 429)
          return yield* new InboxReplyError({
            reason: "rate-limit",
            retryAfter: Number(response.headers["retry-after"]) || 60,
          });
        if (response.status === 401 || response.status === 403)
          return yield* new InboxReplyError({ reason: "permission" });
        if (response.status !== 200)
          return yield* new InboxReplyError({
            reason: response.status >= 500 ? "uncertain" : "rejected",
          });
        const result = yield* response.json.pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Posted)),
          Effect.mapError(() => new InboxReplyError({ reason: "uncertain" })),
        );
        if (!result.ok) {
          const reason = [
            "missing_scope",
            "invalid_auth",
            "token_revoked",
            "token_expired",
            "not_authed",
          ].includes(result.error ?? "")
            ? "permission"
            : ["ratelimited", "rate_limited"].includes(result.error ?? "")
              ? "rate-limit"
              : ["fatal_error", "internal_error", "service_unavailable"].includes(
                    result.error ?? "",
                  )
                ? "uncertain"
                : "rejected";
          return yield* new InboxReplyError({ reason });
        }
        if (!result.ts || !/^\d+\.\d+$/.test(result.ts))
          return yield* new InboxReplyError({ reason: "uncertain" });
        return {
          id: result.ts,
          author: identity.user_id,
          text: result.message?.text ?? input.text,
          occurredAt: DateTime.formatIso(DateTime.makeUnsafe(Number(result.ts) * 1000)),
        };
      }).pipe(
        Effect.timeoutOrElse({
          duration: "45 seconds",
          orElse: () => new InboxReplyError({ reason: "uncertain" }),
        }),
      ),
  });
});
export const layer = Layer.effect(InboxReplyTransport, make);
