import * as Linear from "../linear/LinearConnection.ts";
import * as Superhuman from "./SuperhumanConnection.ts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Schema from "effect/Schema";
import { InboxError, type InboxSourceConnection, type InboxSourceItem } from "@t3tools/contracts";
import { readSlackInbox, SLACK_READ_METHODS } from "./connectors/slack.ts";
const SlackResponse = Schema.Struct({
  ok: Schema.Boolean,
  error: Schema.optionalKey(Schema.String),
});
const decodeSlackResponse = Schema.decodeUnknownSync(SlackResponse);
export class InboxSourceTransport extends Context.Service<
  InboxSourceTransport,
  {
    readonly read: (
      connection: InboxSourceConnection,
      token: string,
      since: string,
    ) => Effect.Effect<ReadonlyArray<InboxSourceItem>, InboxError>;
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
    return InboxSourceTransport.of({
      read: (connection, token, since) =>
        connection.source === "linear"
          ? linear.read(connection.projectId, connection.categories)
          : connection.source === "superhuman"
            ? superhuman.read(connection.projectId, connection.accounts, connection.categories)
            : Effect.tryPromise({
                try: async (signal) => {
                  if (connection.source !== "slack")
                    throw new Error("This connection is not available yet.");
                  return readSlackInbox(
                    async (method, params) => {
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
                      if (!result.ok)
                        throw new Error(
                          `Slack ${method} failed (${result.error ?? "unknown_error"}). Check the connection permissions.`,
                        );
                      return data;
                    },
                    connection.categories,
                    since,
                  );
                },
                catch: (cause) =>
                  new InboxError({
                    detail:
                      cause instanceof Error
                        ? cause.message
                        : "Could not refresh source notifications.",
                  }),
              }).pipe(
                Effect.timeout("2 minutes"),
                Effect.catchTags({
                  TimeoutError: () =>
                    Effect.fail(
                      new InboxError({
                        detail: "Source refresh timed out. Retry when the connection is available.",
                      }),
                    ),
                }),
              ),
    });
  }),
);
