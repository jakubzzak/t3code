import * as Slack from "./SlackConnection.ts";
import * as Linear from "../linear/LinearConnection.ts";
import * as Superhuman from "./SuperhumanConnection.ts";
import * as Redacted from "effect/Redacted";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import {
  LINEAR_INBOX_CATEGORIES,
  InboxError,
  InboxSourceConnection,
  type InboxSourceConfigureInput,
  type InboxSource,
  type ProjectId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as ServerSettings from "../serverSettings.ts";
import * as Secrets from "../auth/ServerSecretStore.ts";
import * as Inbox from "./InboxService.ts";
import * as Transport from "./InboxSourceTransport.ts";
const sources: ReadonlyArray<InboxSource> = ["slack", "linear", "superhuman"];
const empty = (projectId: ProjectId, source: InboxSource): InboxSourceConnection => ({
  projectId,
  source,
  enabled: false,
  connected: false,
  categories:
    source === "slack"
      ? ["dms", "mentions", "group-mentions"]
      : source === "linear"
        ? ["all"]
        : ["split:Important"],
  initialLookbackDays: 7,
  accounts: [],
  lastSyncAt: null,
  error: null,
  retryAt: null,
});
const secretName = (projectId: ProjectId, source: InboxSource) =>
  `inbox-${source}-${encodeURIComponent(projectId)}`;
const iso = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));
export class InboxSources extends Context.Service<
  InboxSources,
  {
    readonly beginSlack: (
      projectId: ProjectId,
      origin: string,
    ) => Effect.Effect<string, InboxError>;
    readonly cancelSlack: (projectId: ProjectId) => Effect.Effect<void>;
    readonly completeSlack: (state: string, code: string) => Effect.Effect<void, InboxError>;
    readonly beginSuperhuman: (
      projectId: ProjectId,
      origin: string,
    ) => Effect.Effect<string, InboxError>;
    readonly completeSuperhuman: (state: string, code: string) => Effect.Effect<void, InboxError>;
    readonly superhumanCatalog: (
      projectId: ProjectId,
    ) => Effect.Effect<Superhuman.SuperhumanCatalog, InboxError>;
    readonly list: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<InboxSourceConnection>, InboxError>;
    readonly configure: (
      input: InboxSourceConfigureInput,
    ) => Effect.Effect<InboxSourceConnection, InboxError>;
    readonly disconnect: (input: {
      projectId: ProjectId;
      source: InboxSource;
    }) => Effect.Effect<void, InboxError>;
    readonly refresh: (input: {
      projectId: ProjectId;
      source: InboxSource;
    }) => Effect.Effect<InboxSourceConnection, InboxError>;
  }
>()("t3/inbox/InboxSources") {}
export const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const settings = yield* ServerSettings.ServerSettingsService;
  const secrets = yield* Secrets.ServerSecretStore;
  const inbox = yield* Inbox.InboxService;
  const transport = yield* Transport.InboxSourceTransport;
  const superhuman = yield* Superhuman.SuperhumanConnection;
  const linear = yield* Linear.LinearConnection;
  const slack = yield* Slack.SlackConnection;
  const locks = new Map<string, Semaphore.Semaphore>();
  const lock = (input: { projectId: ProjectId; source: InboxSource }) => {
    const key = JSON.stringify([input.projectId, input.source]);
    let semaphore = locks.get(key);
    if (!semaphore) {
      semaphore = Semaphore.makeUnsafe(1);
      locks.set(key, semaphore);
    }
    return semaphore.withPermits(1);
  };
  const scope = yield* Effect.scope;
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(InboxSourceConnection));
  const encode = Schema.encodeEffect(Schema.fromJsonString(InboxSourceConnection));
  const error = (cause: unknown) =>
    new InboxError({ detail: "Could not update this project's source connection.", cause });
  const listStored = (projectId: ProjectId) =>
    sql<{
      payload_json: string;
    }>`SELECT payload_json FROM inbox_sources WHERE project_id=${projectId}`.pipe(
      Effect.flatMap((rows) => Effect.forEach(rows, (row) => decode(row.payload_json))),
      Effect.map((connections) =>
        sources.map(
          (source) =>
            connections.find((connection) => connection.source === source) ??
            empty(projectId, source),
        ),
      ),
      Effect.mapError(error),
    );
  const list = (projectId: ProjectId) =>
    listStored(projectId).pipe(
      Effect.flatMap((connections) =>
        Effect.gen(function* () {
          const config = resolveProjectSettings(
            yield* settings.getSettings.pipe(Effect.mapError(error)),
            projectId,
          ).settings;
          if (!config.linearWorkspace) return connections;
          const status = yield* linear
            .request(projectId, {
              operation: "status",
              workspace: config.linearWorkspace,
              connectionKey: projectId,
            })
            .pipe(Effect.result);
          return connections.map((connection) =>
            connection.source === "linear"
              ? {
                  ...connection,
                  connected: status._tag === "Success" && status.success.connection !== null,
                  error: status._tag === "Failure" ? status.failure.detail : connection.error,
                }
              : connection,
          );
        }),
      ),
      Effect.mapError(error),
    );
  const save = (connection: InboxSourceConnection) =>
    encode(connection).pipe(
      Effect.flatMap(
        (json) =>
          sql`INSERT INTO inbox_sources(project_id,source,payload_json) VALUES(${connection.projectId},${connection.source},${json}) ON CONFLICT(project_id,source) DO UPDATE SET payload_json=excluded.payload_json`,
      ),
      Effect.as(connection),
      Effect.mapError(error),
    );
  const refresh = (input: { projectId: ProjectId; source: InboxSource }, force = false) =>
    lock(input)(
      Effect.gen(function* () {
        const connection = (yield* listStored(input.projectId)).find(
          (entry) => entry.source === input.source,
        )!;
        const config = resolveProjectSettings(
          yield* settings.getSettings.pipe(Effect.mapError(error)),
          input.projectId,
        ).settings;
        if (
          !config.inboxEnabled ||
          !connection.enabled ||
          !connection.connected ||
          !connection.categories.length ||
          (connection.source === "superhuman" && !connection.accounts.length)
        )
          return connection;
        const now = yield* Clock.currentTimeMillis;
        if (!force && connection.retryAt && Date.parse(connection.retryAt) > now) return connection;
        const credential = yield* secrets
          .get(secretName(input.projectId, input.source))
          .pipe(Effect.mapError(error));
        if (Option.isNone(credential))
          return yield* save({
            ...connection,
            connected: false,
            error: "Reconnect this source to resume notifications.",
          });
        const since = iso(
          connection.lastSyncAt
            ? Date.parse(connection.lastSyncAt) - 300_000
            : now - connection.initialLookbackDays * 86400_000,
        );
        const result = yield* (
          connection.source === "slack" ? slack.accessToken(input.projectId) : Effect.succeed("")
        ).pipe(
          Effect.flatMap((token) => transport.read(connection, token, since)),
          Effect.flatMap((items) => inbox.ingest(input.projectId, items)),
          Effect.result,
        );
        return yield* save(
          result._tag === "Success"
            ? { ...connection, lastSyncAt: iso(now), error: null, retryAt: iso(now + 60_000) }
            : { ...connection, error: result.failure.detail, retryAt: iso(now + 300_000) },
        );
      }),
    );
  const configure = (input: InboxSourceConfigureInput) =>
    lock(input)(
      Effect.gen(function* () {
        if (
          input.source === "linear" &&
          (input.token ||
            input.categories.some(
              (category) =>
                category !== "all" &&
                !LINEAR_INBOX_CATEGORIES.some((supported) => supported === category),
            ))
        )
          return yield* new InboxError({
            detail: "Connect Linear above and choose notification categories.",
          });
        if (
          input.source === "slack" &&
          input.categories.some(
            (category) => !["dms", "mentions", "group-mentions"].includes(category),
          )
        )
          return yield* new InboxError({
            detail: "Choose supported Slack categories. Saved and To-dos are unavailable.",
          });
        const previous = (yield* input.source === "linear"
          ? list(input.projectId)
          : listStored(input.projectId)).find((entry) => entry.source === input.source)!;
        if (input.source === "superhuman") {
          if (input.token)
            return yield* new InboxError({
              detail: "Connect Superhuman using its authorization flow.",
            });
          const catalog = yield* superhuman.catalog(input.projectId);
          if (
            input.accounts?.some((account) => !catalog.accounts.includes(account)) ||
            input.categories.some(
              (category) =>
                !catalog.splits.some(
                  (split) =>
                    input.accounts?.includes(split.accountEmail) &&
                    category === `split:${split.name}`,
                ) &&
                !catalog.labels.some(
                  (label) =>
                    input.accounts?.includes(label.accountEmail) &&
                    category === `label:${label.name}`,
                ),
            )
          )
            return yield* new InboxError({
              detail: "Choose connected accounts and available Superhuman splits or labels.",
            });
        }
        if (input.token) {
          const token = Redacted.value(input.token).trim();
          if (!token.startsWith("xoxp-"))
            return yield* new InboxError({
              detail: "Use a Slack user OAuth token with the selected read permissions.",
            });
          yield* secrets
            .set(secretName(input.projectId, input.source), new TextEncoder().encode(token))
            .pipe(Effect.mapError(error));
        }
        if (input.enabled && !previous.connected && !input.token)
          return yield* new InboxError({ detail: "Connect this source before enabling it." });
        return yield* save({
          ...previous,
          enabled: input.enabled,
          connected: previous.connected || input.token !== undefined,
          categories: [...new Set(input.categories)],
          accounts: input.accounts ?? previous.accounts,
          initialLookbackDays: input.initialLookbackDays ?? previous.initialLookbackDays,
          lastSyncAt:
            input.token ||
            (input.initialLookbackDays !== undefined &&
              input.initialLookbackDays !== previous.initialLookbackDays) ||
            input.categories.length !== previous.categories.length ||
            input.categories.some((category, index) => category !== previous.categories[index])
              ? null
              : previous.lastSyncAt,
          error: null,
          retryAt: null,
        });
      }),
    ).pipe(
      Effect.tap((connection) =>
        refresh(connection).pipe(
          Effect.catch(() => Effect.void),
          Effect.forkIn(scope),
        ),
      ),
    );
  const disconnect = (input: { projectId: ProjectId; source: InboxSource }) =>
    lock(input)(
      Effect.gen(function* () {
        if (input.source === "linear") yield* linear.disconnect(input.projectId);
        else if (input.source === "superhuman") yield* superhuman.disconnect(input.projectId);
        else yield* slack.disconnect(input.projectId);
        yield* save(empty(input.projectId, input.source));
      }),
    );
  const poll = sql<{ payload_json: string }>`SELECT payload_json FROM inbox_sources`.pipe(
    Effect.flatMap((rows) =>
      Effect.forEach(
        rows,
        (row) => decode(row.payload_json).pipe(Effect.flatMap((connection) => refresh(connection))),
        {
          concurrency: 3,
          discard: true,
        },
      ),
    ),
    Effect.catch(() => Effect.logWarning("Inbox sources could not be refreshed.")),
  );
  yield* poll.pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.forkIn(scope));
  return InboxSources.of({
    list,
    configure,
    disconnect,
    refresh: (input) => refresh(input, true),
    beginSlack: slack.begin,
    cancelSlack: slack.cancel,
    completeSlack: (state, code) =>
      slack.complete(state, code).pipe(
        Effect.flatMap(({ projectId, account }) =>
          lock({ projectId, source: "slack" })(
            Effect.gen(function* () {
              const previous = (yield* listStored(projectId)).find(
                (entry) => entry.source === "slack",
              )!;
              yield* save({ ...previous, connected: true, account, error: null, retryAt: null });
            }),
          ),
        ),
      ),
    beginSuperhuman: superhuman.begin,
    superhumanCatalog: superhuman.catalog,
    completeSuperhuman: (state, code) =>
      superhuman.complete(state, code).pipe(
        Effect.flatMap((projectId) =>
          lock({ projectId, source: "superhuman" })(
            Effect.gen(function* () {
              const previous = (yield* listStored(projectId)).find(
                (entry) => entry.source === "superhuman",
              )!;
              yield* save({ ...previous, connected: true, error: null, retryAt: null });
            }),
          ),
        ),
      ),
  });
});
export const layer: Layer.Layer<
  InboxSources,
  never,
  | SqlClient.SqlClient
  | ServerSettings.ServerSettingsService
  | Secrets.ServerSecretStore
  | Inbox.InboxService
  | Transport.InboxSourceTransport
  | Superhuman.SuperhumanConnection
  | Slack.SlackConnection
  | Linear.LinearConnection
> = Layer.effect(InboxSources, make);
