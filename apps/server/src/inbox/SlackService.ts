import { SlackReadInput, SlackSendInput, SlackSendResult } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as SqlClient from "effect/sql/SqlClient";
import * as Connection from "./SlackConnection.ts";

export class SlackError extends Schema.TaggedError<SlackError>()("SlackError", {
  reason: Schema.Literals([
    "permission",
    "rate-limit",
    "rejected",
    "uncertain",
    "storage",
    "conflict",
  ]),
  retryAfter: Schema.optionalKey(Schema.Number),
  cause: Schema.optionalKey(Schema.Defect()),
}) {
  override get message() {
    switch (this.reason) {
      case "permission":
        return "Slack permission or account changed. Check the connection and reconnect for the required scopes.";
      case "rate-limit":
        return "Slack rate limit reached. Wait before trying again.";
      case "uncertain":
        return "Slack delivery is uncertain. Check the destination; do not resend automatically.";
      case "storage":
        return "Could not access the Slack send receipt. Reuse the same commandId; do not resend with a new ID.";
      case "conflict":
        return "This commandId already belongs to a different Slack message. Use it only to check the original attempt.";
      case "rejected":
        return "Slack rejected the request. Check the destination, parameters and permissions.";
    }
  }
}

export class SlackService extends Context.Service<
  SlackService,
  {
    readonly read: (input: SlackReadInput) => Effect.Effect<Record<string, unknown>, SlackError>;
    readonly send: <E = never, R = never>(
      input: SlackSendInput,
      check?: Effect.Effect<void, E, R>,
    ) => Effect.Effect<SlackSendResult, SlackError | E, R>;
  }
>()("t3/inbox/SlackService") {}

const Envelope = Schema.Struct({ ok: Schema.Boolean, error: Schema.optionalKey(Schema.String) });
const Identity = Schema.Struct({ team_id: Schema.String, user_id: Schema.String });
const Opened = Schema.Struct({ channel: Schema.Struct({ id: Schema.String }) });
const Posted = Schema.Struct({
  channel: Schema.String,
  ts: Schema.String.check(Schema.isPattern(/^\d+\.\d+$/)),
});
const decodeReceipt = Schema.decodeUnknownEffect(Schema.fromJsonString(SlackSendResult));
const encodeReceipt = Schema.encodeEffect(Schema.fromJsonString(SlackSendResult));
const encodeInput = Schema.encodeEffect(Schema.fromJsonString(SlackSendInput));
const decodeInput = Schema.decodeEffect(SlackSendInput);
const decodeRead = Schema.decodeEffect(SlackReadInput);
const decodeEnvelope = Schema.decodeUnknownEffect(Envelope);
const decodeIdentity = Schema.decodeUnknownEffect(Identity);
const decodeOpened = Schema.decodeUnknownEffect(Opened);
const decodePosted = Schema.decodeUnknownEffect(Posted);
const decodeData = Schema.decodeUnknownEffect(Schema.Record(Schema.String, Schema.Unknown));
const isSlackError = Schema.is(SlackError);

const make = Effect.gen(function* () {
  const connection = yield* Connection.SlackConnection;
  const http = yield* HttpClient.HttpClient;
  const sql = yield* SqlClient.SqlClient;
  const call = Effect.fnUntraced(function* (
    token: string,
    method: string,
    parameters: Record<string, unknown>,
    write = false,
    posting = false,
  ) {
    const request = write
      ? HttpClientRequest.post(`https://slack.com/api/${method}`).pipe(
          HttpClientRequest.bodyJsonUnsafe(parameters),
        )
      : HttpClientRequest.get(`https://slack.com/api/${method}`).pipe(
          HttpClientRequest.setUrlParams(
            Object.fromEntries(
              Object.entries(parameters).map(([key, value]) => [key, String(value)]),
            ),
          ),
        );
    const execute = http.execute(
      request.pipe(HttpClientRequest.setHeader("Authorization", `Bearer ${token}`)),
    );
    // HTTP spans include the full URL. Keep private read parameters out of both
    // local diagnostics and delegated tracers; SlackService.read retains its operation span.
    const response = yield* (
      write
        ? execute
        : execute.pipe(Effect.provideService(HttpClient.TracerDisabledWhen, () => true))
    ).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }),
      Effect.mapError(
        (cause) => new SlackError({ reason: posting ? "uncertain" : "rejected", cause }),
      ),
      Effect.timeoutOrElse({
        duration: "30 seconds",
        orElse: () => new SlackError({ reason: posting ? "uncertain" : "rejected" }),
      }),
    );
    if (response.status === 429)
      return yield* new SlackError({
        reason: "rate-limit",
        retryAfter: Number(response.headers["retry-after"]) || 60,
      });
    if (response.status === 401 || response.status === 403)
      return yield* new SlackError({ reason: "permission" });
    if (response.status !== 200)
      return yield* new SlackError({
        reason:
          posting && (response.status >= 500 || response.status === 408) ? "uncertain" : "rejected",
      });
    const data = yield* response.json.pipe(
      Effect.flatMap(decodeData),
      Effect.mapError(
        (cause) => new SlackError({ reason: posting ? "uncertain" : "rejected", cause }),
      ),
      Effect.timeoutOrElse({
        duration: "30 seconds",
        orElse: () => new SlackError({ reason: posting ? "uncertain" : "rejected" }),
      }),
    );
    const envelope = yield* decodeEnvelope(data).pipe(
      Effect.mapError(
        (cause) => new SlackError({ reason: posting ? "uncertain" : "rejected", cause }),
      ),
    );
    if (!envelope.ok) {
      const code = envelope.error ?? "";
      return yield* new SlackError({
        reason: [
          "missing_scope",
          "invalid_auth",
          "token_revoked",
          "token_expired",
          "not_authed",
        ].includes(code)
          ? "permission"
          : ["ratelimited", "rate_limited"].includes(code)
            ? "rate-limit"
            : posting &&
                [
                  "fatal_error",
                  "internal_error",
                  "service_unavailable",
                  "request_timeout",
                ].includes(code)
              ? "uncertain"
              : "rejected",
      });
    }
    return {
      data,
      scopes: (response.headers["x-oauth-scopes"] ?? "").split(",").map((scope) => scope.trim()),
    };
  });
  const tokenFor = (projectId: SlackReadInput["projectId"]) =>
    connection
      .accessToken(projectId)
      .pipe(Effect.mapError((cause) => new SlackError({ reason: "permission", cause })));
  return SlackService.of({
    read: Effect.fn("SlackService.read")(function* (input) {
      // Validate here as well: read-only callers must never reach a mutating API method.
      const decoded = yield* decodeRead(input).pipe(
        Effect.mapError((cause) => new SlackError({ reason: "rejected", cause })),
      );
      yield* Effect.annotateCurrentSpan("slack.method", decoded.method);
      if ("token" in decoded.parameters) return yield* new SlackError({ reason: "rejected" });
      const parameters = { ...decoded.parameters };
      const pageSize = decoded.method.startsWith("search.") ? "count" : "limit";
      if (
        [
          "users.list",
          "conversations.list",
          "conversations.members",
          "conversations.history",
          "conversations.replies",
          "search.messages",
          "search.files",
        ].includes(decoded.method)
      ) {
        parameters[pageSize] = String(
          Math.max(1, Math.min(100, Number(parameters[pageSize]) || 100)),
        );
      }
      return (yield* call(yield* tokenFor(decoded.projectId), decoded.method, parameters)).data;
    }),
    send: (input, check = Effect.void) =>
      Effect.gen(function* () {
        const decoded = yield* decodeInput(input).pipe(
          Effect.mapError((cause) => new SlackError({ reason: "rejected", cause })),
        );
        const destination =
          decoded.destination.channelId !== undefined
            ? { channelId: decoded.destination.channelId }
            : { userIds: [...new Set(decoded.destination.userIds)].sort() };
        const json = yield* encodeInput({ ...decoded, destination }).pipe(
          Effect.mapError((cause) => new SlackError({ reason: "rejected", cause })),
        );
        yield* check;
        // Claim before touching Slack. A crash, cancellation or lost response leaves a receipt
        // that subsequent calls inspect instead of sending a second message.
        const pending: SlackSendResult = { commandId: decoded.commandId, status: "pending" };
        const pendingJson = yield* encodeReceipt(pending).pipe(
          Effect.mapError((cause) => new SlackError({ reason: "storage", cause })),
        );
        const claimed =
          yield* sql`INSERT INTO slack_send_attempts(command_id,project_id,input_json,result_json)
        VALUES(${decoded.commandId},${decoded.projectId},${json},${pendingJson})
        ON CONFLICT(command_id) DO NOTHING RETURNING command_id`.pipe(
            Effect.mapError((cause) => new SlackError({ reason: "storage", cause })),
          );
        if (!claimed.length) {
          const rows = yield* sql<{
            input_json: string;
            result_json: string;
          }>`SELECT input_json,result_json FROM slack_send_attempts WHERE command_id=${decoded.commandId}`.pipe(
            Effect.mapError((cause) => new SlackError({ reason: "storage", cause })),
          );
          if (rows[0]?.input_json !== json) return yield* new SlackError({ reason: "conflict" });
          return yield* decodeReceipt(rows[0].result_json).pipe(
            Effect.mapError((cause) => new SlackError({ reason: "storage", cause })),
          );
        }
        const outcome = yield* Effect.gen(function* () {
          const token = yield* tokenFor(decoded.projectId);
          const account = yield* call(token, "auth.test", {});
          const identity = yield* decodeIdentity(account.data).pipe(
            Effect.mapError((cause) => new SlackError({ reason: "permission", cause })),
          );
          if (
            `${identity.team_id}:${identity.user_id}` !== decoded.connectionId ||
            !account.scopes.includes("chat:write")
          )
            return yield* new SlackError({ reason: "permission" });
          yield* check;
          let channelId: string;
          if ("channelId" in destination) channelId = destination.channelId;
          else {
            if (
              !account.scopes.includes(destination.userIds.length > 1 ? "mpim:write" : "im:write")
            )
              return yield* new SlackError({ reason: "permission" });
            const opened = yield* call(
              token,
              "conversations.open",
              { users: destination.userIds.join(","), return_im: true },
              true,
            );
            channelId = (yield* decodeOpened(opened.data).pipe(
              Effect.mapError((cause) => new SlackError({ reason: "rejected", cause })),
            )).channel.id;
          }
          yield* check;
          const posted = yield* call(
            token,
            "chat.postMessage",
            {
              channel: channelId,
              text: decoded.text,
              ...(decoded.threadTs ? { thread_ts: decoded.threadTs } : {}),
              ...(decoded.blocks ? { blocks: decoded.blocks } : {}),
              reply_broadcast: false,
              unfurl_links: false,
              unfurl_media: false,
            },
            true,
            true,
          );
          const message = yield* decodePosted(posted.data).pipe(
            Effect.mapError(() => new SlackError({ reason: "uncertain" })),
          );
          return {
            commandId: decoded.commandId,
            status: "sent" as const,
            channelId: message.channel,
            ts: message.ts,
          };
        }).pipe(Effect.result);
        let result: SlackSendResult;
        if (outcome._tag === "Success") result = outcome.success;
        else {
          if (!isSlackError(outcome.failure)) return yield* Effect.fail(outcome.failure);
          const error = outcome.failure;
          result = {
            commandId: decoded.commandId,
            status: error.reason === "uncertain" ? "uncertain" : "failed",
            error: error.message,
            ...(error.retryAfter ? { retryAfter: error.retryAfter } : {}),
          };
        }
        const resultJson = yield* encodeReceipt(result).pipe(
          Effect.mapError((cause) => new SlackError({ reason: "storage", cause })),
        );
        yield* sql`UPDATE slack_send_attempts SET result_json=${resultJson} WHERE command_id=${decoded.commandId}`.pipe(
          Effect.mapError((cause) => new SlackError({ reason: "storage", cause })),
        );
        return result;
      }),
  });
});

export const layer = Layer.effect(SlackService, make);
