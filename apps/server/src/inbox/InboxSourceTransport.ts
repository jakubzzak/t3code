import * as Linear from "../linear/LinearConnection.ts";
import * as Superhuman from "./SuperhumanConnection.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import { isSlackFileUrl } from "./slackFiles.ts";
import {
  InboxError,
  type InboxSourceConnection,
  type InboxSourceItem,
  type InboxSlackThread,
} from "@t3tools/contracts";
import { readSlackThread } from "./connectors/slackThread.ts";
import {
  readSlackInbox,
  SlackReadError,
  SLACK_READ_METHODS,
  type SlackRead,
} from "./connectors/slack.ts";
const SlackResponse = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
});
const decodeSlackResponse = Schema.decodeUnknownSync(SlackResponse);
export class InboxSourceTransport extends Context.Service<
  InboxSourceTransport,
  {
    readonly readImage: (
      token: string,
      url: string,
      connectionId: string,
    ) => Effect.Effect<{ bytes: Uint8Array; mimeType: string }, InboxError>;
    readonly readThread: (
      token: string,
      channelId: string,
      ts: string,
      cached?: InboxSlackThread,
    ) => Effect.Effect<InboxSlackThread, InboxError>;
    readonly read: (
      connection: InboxSourceConnection,
      token: string,
      since: string,
      tracked?: ReadonlyArray<
        Pick<InboxSourceItem, "connectionId" | "groupId" | "linearCommentTarget">
      >,
    ) => Effect.Effect<
      {
        readonly items: ReadonlyArray<InboxSourceItem>;
        readonly slackRetryThreads?: InboxSourceConnection["slackRetryThreads"];
      },
      InboxError
    >;
  }
>()("t3/inbox/InboxSourceTransport") {}
export const layer: Layer.Layer<
  InboxSourceTransport,
  never,
  HttpClient.HttpClient | Superhuman.SuperhumanConnection | Linear.LinearConnection
> = Layer.effect(
  InboxSourceTransport,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());
    const superhuman = yield* Superhuman.SuperhumanConnection;
    const linear = yield* Linear.LinearConnection;
    const slackRead = <A>(operation: (read: SlackRead) => Promise<A>, token: string) =>
      Effect.tryPromise({
        try: (signal) =>
          operation(async (method, params) => {
            if (!SLACK_READ_METHODS.has(method))
              throw new Error("Unsupported Slack read operation.");
            const response = await runPromise(
              client.execute(
                HttpClientRequest.get(
                  `https://slack.com/api/${method}?${new URLSearchParams(params)}`,
                ).pipe(HttpClientRequest.setHeader("Authorization", `Bearer ${token}`)),
              ),
              { signal },
            );
            if (response.status === 429)
              throw new Error(
                `Slack rate limit reached. Retry after ${response.headers["retry-after"] ?? "60"} seconds.`,
              );
            if (response.status < 200 || response.status >= 300)
              throw new Error(`Slack connection failed (${response.status}).`);
            const data: unknown = await runPromise(response.json, { signal });
            const result = decodeSlackResponse(data);
            if (!result.ok) throw new SlackReadError(method, result.error ?? "unknown_error");
            return data;
          }),
        catch: (cause) =>
          new InboxError({
            detail: cause instanceof Error ? cause.message : "Could not read Slack messages.",
          }),
      }).pipe(
        Effect.timeout("2 minutes"),
        Effect.catchTags({
          TimeoutError: () =>
            Effect.fail(new InboxError({ detail: "Slack request timed out. Try again." })),
        }),
      );
    return InboxSourceTransport.of({
      readImage: (token, url, connectionId) =>
        Effect.gen(function* () {
          if (!isSlackFileUrl(url))
            return yield* new InboxError({ detail: "This image is not hosted by Slack." });
          const identityResponse = yield* client.execute(
            HttpClientRequest.get("https://slack.com/api/auth.test").pipe(
              HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
            ),
          );
          const identity = yield* identityResponse.json.pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.Struct({
                  ok: Schema.Boolean,
                  team_id: Schema.String,
                  user_id: Schema.String,
                }),
              ),
            ),
          );
          if (!identity.ok || `${identity.team_id}:${identity.user_id}` !== connectionId)
            return yield* new InboxError({ detail: "Slack account changed." });
          const response = yield* client
            .execute(
              HttpClientRequest.get(url).pipe(
                HttpClientRequest.setHeader("Authorization", `Bearer ${token}`),
              ),
            )
            .pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" }));
          const mimeType = response.headers["content-type"]?.split(";")[0]?.trim() ?? "";
          if (response.status !== 200 || !/^image\/(?:png|jpeg|gif|webp)$/.test(mimeType))
            return yield* new InboxError({
              detail:
                "Image unavailable. Reconnect Slack to grant file access, or open it in Slack.",
            });
          let size = 0;
          const chunks = yield* Stream.runCollect(
            response.stream.pipe(
              Stream.mapEffect((chunk) => {
                size += chunk.length;
                return size > 10 * 1024 * 1024
                  ? Effect.fail(
                      new InboxError({ detail: "Image exceeds the 10 MB preview limit." }),
                    )
                  : Effect.succeed(chunk);
              }),
            ),
          );
          const bytes = new Uint8Array(size);
          let offset = 0;
          for (const chunk of chunks) {
            bytes.set(chunk, offset);
            offset += chunk.length;
          }
          return { bytes, mimeType };
        }).pipe(
          Effect.timeout("30 seconds"),
          Effect.mapError(
            () =>
              new InboxError({
                detail: "Could not load Slack image. Check file access or open it in Slack.",
              }),
          ),
        ),
      readThread: (token, channelId, ts, cached) =>
        slackRead((read) => readSlackThread(read, channelId, ts, cached), token),
      read: (connection, token, since, tracked) =>
        connection.source === "linear"
          ? linear
              .read(connection.projectId, connection.categories, since, tracked)
              .pipe(Effect.map((items) => ({ items })))
          : connection.source === "superhuman"
            ? superhuman
                .read(
                  connection.projectId,
                  connection.accounts,
                  connection.categories,
                  since,
                  tracked,
                )
                .pipe(Effect.map((items) => ({ items })))
            : slackRead(
                (read) =>
                  readSlackInbox(
                    read,
                    connection.categories,
                    since,
                    tracked,
                    connection.slackRetryThreads,
                  ),
                token,
              ),
    });
  }),
);
