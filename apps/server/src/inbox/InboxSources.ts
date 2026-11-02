import * as Slack from "./SlackConnection.ts";
import * as Linear from "../linear/LinearConnection.ts";
import * as Superhuman from "./SuperhumanConnection.ts";
import * as Redacted from "effect/Redacted";
import * as Clock from "effect/Clock";
import * as Cache from "effect/Cache";
import * as Data from "effect/Data";
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
  DEFAULT_SERVER_SETTINGS,
  LINEAR_INBOX_CATEGORIES,
  InboxError,
  InboxSourceConnection,
  type InboxSourceConfigureInput,
  type InboxSource,
  type InboxGetInput,
  type InboxNotification,
  type InboxSlackThread,
  type InboxLinearAgentThread,
  type InboxLinearAgentThreadInput,
  ProjectId,
} from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as ServerSettings from "../serverSettings.ts";
import * as Secrets from "../auth/ServerSecretStore.ts";
import * as Inbox from "./InboxService.ts";
import * as Transport from "./InboxSourceTransport.ts";
import { inboxHistorySince } from "./inboxHistory.ts";
class AgentThreadKey extends Data.Class<{ projectId: ProjectId; commentId: string }> {}

const sources: ReadonlyArray<InboxSource> = ["slack", "linear", "superhuman"];
const empty = (projectId: ProjectId, source: InboxSource): InboxSourceConnection => ({
  projectId,
  source,
  enabled: true,
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
    readonly image: (input: {
      projectId: ProjectId;
      notificationId: string;
      fileId: string;
    }) => Effect.Effect<{ bytes: Uint8Array; mimeType: string }, InboxError>;
    readonly get: (input: InboxGetInput) => Effect.Effect<InboxNotification | null, InboxError>;
    readonly linearAgentThread: (
      input: InboxLinearAgentThreadInput,
    ) => Effect.Effect<InboxLinearAgentThread | null, InboxError>;
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
  const agentThreads = yield* Cache.make({
    capacity: 128,
    timeToLive: "5 seconds",
    lookup: ({ projectId, commentId }: { projectId: ProjectId; commentId: string }) =>
      linear.readAgentThread(projectId, commentId),
  });
  const slack = yield* Slack.SlackConnection;
  const locks = new Map<string, Semaphore.Semaphore>();
  const lock = (input: { projectId: ProjectId; source: InboxSource }) => {
    const key = `${input.projectId}:${input.source}`;
    let semaphore = locks.get(key);
    if (!semaphore) {
      semaphore = Semaphore.makeUnsafe(1);
      locks.set(key, semaphore);
    }
    return semaphore.withPermits(1);
  };
  const scope = yield* Effect.scope;
  const decodeStored = Schema.decodeUnknownEffect(Schema.fromJsonString(InboxSourceConnection));
  // Keep the legacy wire field readable, but Inbox is the only collection opt-in.
  const decode = (json: string) =>
    decodeStored(json).pipe(Effect.map((connection) => ({ ...connection, enabled: true })));
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
          const slackStatus = yield* slack.status(projectId).pipe(Effect.orElseSucceed(() => ({})));
          const withSlack = connections.map((connection) =>
            connection.source === "slack" ? { ...connection, ...slackStatus } : connection,
          );
          if (!config.linearWorkspace) return withSlack;
          const status = yield* linear
            .request(projectId, {
              operation: "status",
              workspace: config.linearWorkspace,
              connectionKey: projectId,
            })
            .pipe(Effect.result);
          return withSlack.map((connection) =>
            connection.source === "linear"
              ? {
                  ...connection,
                  connected: status._tag === "Success" && status.success.connection !== null,
                  canReply:
                    status._tag === "Success" && (status.success.connection?.canReply ?? false),
                  ...(status._tag === "Success" && status.success.connection
                    ? { account: status.success.connection.name }
                    : {}),
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
        const config = resolveProjectSettings(
          yield* settings.getSettings.pipe(Effect.mapError(error)),
          input.projectId,
        ).settings;
        let connection = (yield* listStored(input.projectId)).find(
          (entry) => entry.source === input.source,
        )!;
        if (!config.inboxEnabled) return connection;
        const now = yield* Clock.currentTimeMillis;
        const enabledAt =
          config.inboxEnabledAtByProject[input.projectId] ??
          connection.collectionStartedAt ??
          iso(now);
        const policyMatches =
          (!connection.collectionStartedAt || connection.collectionStartedAt === enabledAt) &&
          (connection.collectionHistoryDays ?? DEFAULT_SERVER_SETTINGS.inboxInitialHistoryDays) ===
            config.inboxInitialHistoryDays;
        if (!force) {
          if (connection.error && connection.retryAt && Date.parse(connection.retryAt) > now)
            return connection;
          if (
            policyMatches &&
            connection.lastSyncAt &&
            Date.parse(connection.lastSyncAt) + config.inboxRefreshIntervalMinutes * 60_000 > now
          )
            return connection;
        }
        // Read connection status and secrets only when this source is actually due.
        if (input.source === "linear")
          connection = (yield* list(input.projectId)).find((entry) => entry.source === "linear")!;
        if (
          !connection.connected ||
          !connection.categories.length ||
          (connection.source === "superhuman" && !connection.accounts.length)
        )
          return connection;
        const credential = yield* secrets
          .get(secretName(input.projectId, input.source))
          .pipe(Effect.mapError(error));
        if (Option.isNone(credential))
          return yield* save({
            ...connection,
            connected: false,
            error: "Reconnect this source to resume notifications.",
          });
        const since = inboxHistorySince(
          enabledAt,
          config.inboxInitialHistoryDays,
          now,
          policyMatches ? connection.lastSyncAt : null,
        );
        // Only native identities leave storage; source connectors read new activity since the checkpoint.
        const tracked = yield* sql<{
          connectionId: string;
          groupId: string;
          linearCommentTarget: string | null;
        }>`
          SELECT DISTINCT json_extract(n.payload_json, '$.connectionId') AS connectionId,
            json_extract(n.payload_json, '$.groupId') AS groupId,
            CASE WHEN ${input.source}='linear' THEN
              COALESCE(json_extract(item.value, '$.linearCommentTarget'),
                CASE WHEN json_extract(item.value, '$.linearIssue.id') IS NULL
                  THEN 'notification:' || json_extract(item.value, '$.id') END)
            END AS linearCommentTarget
          FROM inbox_notifications AS n, json_each(
            CASE WHEN ${input.source}='linear' THEN json_extract(n.payload_json, '$.items')
              ELSE '[{}]' END
          ) AS item
          WHERE n.project_id=${input.projectId}
            AND json_extract(n.payload_json, '$.source')=${input.source}`.pipe(
          Effect.map((rows) =>
            rows.map(({ linearCommentTarget, ...row }) => ({
              ...row,
              ...(linearCommentTarget ? { linearCommentTarget } : {}),
            })),
          ),
          Effect.mapError(error),
        );
        const retryBoundaries = new Map(
          (policyMatches ? (connection.slackRetryThreads ?? []) : []).map((entry) => [
            `${entry.connectionId}/${entry.groupId}`,
            entry.since,
          ]),
        );
        const result = yield* (
          connection.source === "slack" ? slack.accessToken(input.projectId) : Effect.succeed("")
        ).pipe(
          Effect.flatMap((token) =>
            transport.read(
              policyMatches ? connection : { ...connection, slackRetryThreads: [] },
              token,
              since,
              tracked,
            ),
          ),
          Effect.flatMap((batch) =>
            settings
              .withSettingsSnapshot((snapshot) =>
                Effect.gen(function* () {
                  const latest = resolveProjectSettings(snapshot, input.projectId).settings;
                  if (
                    !latest.inboxEnabled ||
                    (latest.inboxEnabledAtByProject[input.projectId] ?? enabledAt) !== enabledAt ||
                    latest.inboxInitialHistoryDays !== config.inboxInitialHistoryDays
                  )
                    return false;
                  return yield* inbox
                    .ingest(
                      input.projectId,
                      batch.items.filter((item) => {
                        const boundary =
                          retryBoundaries.get(`${item.connectionId}/${item.groupId}`) ?? since;
                        return Date.parse(item.occurredAt) >= Date.parse(boundary);
                      }),
                    )
                    .pipe(Effect.as(batch));
                }),
              )
              .pipe(Effect.mapError(error)),
          ),
          Effect.result,
        );
        if (result._tag === "Failure")
          return yield* save({
            ...connection,
            error: result.failure.detail,
            retryAt: iso(now + 300_000),
          });
        if (!result.success) return connection;
        const pending = result.success.slackRetryThreads ?? [];
        return yield* save({
          ...connection,
          collectionStartedAt: enabledAt,
          collectionHistoryDays: config.inboxInitialHistoryDays,
          lastSyncAt: iso(now),
          ...(connection.source === "slack" ? { slackRetryThreads: pending } : {}),
          error: pending.length
            ? "Some Slack threads are unavailable. Restore channel access to retry."
            : null,
          retryAt: pending.length ? iso(now + 300_000) : null,
        });
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
        return yield* save({
          ...previous,
          enabled: true,
          connected: previous.connected || input.token !== undefined,
          categories: [...new Set(input.categories)],
          accounts: input.accounts ?? previous.accounts,
          lastSyncAt:
            input.token ||
            input.categories.length !== previous.categories.length ||
            input.categories.some((category, index) => category !== previous.categories[index]) ||
            (input.accounts !== undefined &&
              (input.accounts.length !== previous.accounts.length ||
                input.accounts.some((account) => !previous.accounts.includes(account))))
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
  // Slow source reads must not delay the cadence of unrelated projects or accumulate queued polls.
  const polling = new Set<string>();
  const pollPermits = yield* Semaphore.make(3);
  const poll = Effect.gen(function* () {
    const config = yield* settings.getSettings.pipe(Effect.mapError(error));
    const stored = yield* sql<{
      project_id: string;
    }>`SELECT DISTINCT project_id FROM inbox_sources`;
    const projects = new Set([
      ...stored.map((row) => row.project_id),
      ...Object.keys(config.projectSettingsOverrides),
    ]);
    const candidates = [...projects]
      .map((id) => ProjectId.make(id))
      .filter((id) => resolveProjectSettings(config, id).settings.inboxEnabled)
      .flatMap((projectId) => sources.map((source) => ({ projectId, source })));
    for (const input of candidates) {
      const key = `${input.projectId}:${input.source}`;
      if (polling.has(key)) continue;
      polling.add(key);
      yield* pollPermits
        .withPermits(1)(refresh(input))
        .pipe(
          Effect.catch(() => Effect.logWarning("Inbox source could not be refreshed.")),
          Effect.ensuring(Effect.sync(() => polling.delete(key))),
          Effect.forkIn(scope),
        );
    }
  }).pipe(Effect.catch(() => Effect.logWarning("Inbox sources could not be refreshed.")));
  yield* poll.pipe(Effect.repeat(Schedule.spaced("15 seconds")), Effect.forkIn(scope));
  const get = (input: InboxGetInput) =>
    Effect.gen(function* () {
      const item = yield* inbox.get(input);
      if (item?.source === "linear") {
        const issue =
          item.linearIssue ?? item.items.findLast((entry) => entry.linearIssue)?.linearIssue;
        const isLegacyIssue =
          !issue &&
          item.items.some((entry) => /^https:\/\/linear\.app\/[^/]+\/issue\//.test(entry.url));
        if (
          issue?.commentMetadataVersion === 1 &&
          issue.agentMetadataVersion === 1 &&
          ((!input.loadPreviousComments && !isLegacyIssue && issue.commentCount !== undefined) ||
            issue.commentsComplete)
        )
          return item;
        if (!issue && !isLegacyIssue) return item;
        return yield* lock({ projectId: input.projectId, source: "linear" })(
          Effect.gen(function* () {
            const current = yield* inbox.get(input);
            if (
              !current ||
              (current.linearIssue?.commentMetadataVersion === 1 &&
                current.linearIssue.agentMetadataVersion === 1 &&
                (current.linearIssue.commentsComplete ||
                  (!input.loadPreviousComments && current.linearIssue.commentCount !== undefined)))
            )
              return current;
            const detail = yield* linear
              .readIssue(
                input.projectId,
                current.groupId,
                !!input.loadPreviousComments || isLegacyIssue || !!issue?.commentsComplete,
              )
              .pipe(
                Effect.catchTags({
                  InboxError: (cause) =>
                    !input.loadPreviousComments && issue
                      ? Effect.succeed(null)
                      : Effect.fail(cause),
                }),
              );
            if (!detail) return current;
            return yield* inbox.cacheLinearIssue({
              ...input,
              issue: detail,
              expectedAnalysisVersion: current.analysisVersion,
              expectedRevision: current.revision,
            });
          }),
        );
      }
      if (!item || item.source !== "slack" || !/^[CDG][A-Z0-9]+:\d+(?:\.\d+)?$/.test(item.groupId))
        return item;
      if (
        item.slackThread?.formatVersion === 2 &&
        item.slackThread.root.images !== undefined &&
        (!input.loadPreviousComments || !item.slackThread.nextCursor)
      )
        return item;
      return yield* lock({ projectId: input.projectId, source: "slack" })(
        Effect.gen(function* () {
          let current = yield* inbox.get(input);
          if (!current) return null;
          if (
            current.slackThread?.formatVersion === 2 &&
            current.slackThread.root.images !== undefined &&
            (!input.loadPreviousComments || !current.slackThread.nextCursor)
          )
            return current;
          const [channelId, ts] = current.groupId.split(":");
          const token = yield* slack.accessToken(input.projectId);
          const seen = new Set<string>();
          let pages = 0;
          while (
            current.slackThread?.formatVersion !== 2 ||
            current.slackThread.root.images === undefined ||
            (input.loadPreviousComments && current.slackThread.nextCursor)
          ) {
            const cursor = current.slackThread?.nextCursor;
            if ((cursor && seen.has(cursor)) || pages++ >= 100)
              return yield* Effect.fail(
                new InboxError({
                  detail: "Thread history is too large to load at once. Open the original thread.",
                }),
              );
            if (cursor) seen.add(cursor);
            const thread: InboxSlackThread = yield* transport.readThread(
              token,
              channelId!,
              ts!,
              current.slackThread,
            );
            current = yield* inbox.cacheSlackThread({
              projectId: input.projectId,
              id: input.id,
              thread,
            });
            if (!current) return null;
          }
          return current;
        }),
      );
    });
  return InboxSources.of({
    image: (input) =>
      Effect.gen(function* () {
        const notification = yield* inbox.get({
          projectId: input.projectId,
          id: input.notificationId,
        });
        const thread = notification?.slackThread;
        const image =
          thread &&
          [thread.root, ...thread.messages, ...(thread.pendingMessages ?? [])]
            .flatMap((message) => message.images ?? [])
            .find((image) => image.id === input.fileId);
        if (!image?.url || notification?.source !== "slack")
          return yield* new InboxError({ detail: "Image unavailable." });
        const token = yield* slack.accessToken(input.projectId);
        return yield* transport.readImage(token, image.url, notification.connectionId);
      }),
    get,
    linearAgentThread: (input) =>
      Effect.gen(function* () {
        const item = yield* inbox.get(input);
        if (item?.source !== "linear") return null;
        const target = item.items.at(-1)?.replyTarget;
        if (target?.source !== "linear" || !target.parentId) return null;
        return yield* Cache.get(
          agentThreads,
          new AgentThreadKey({ projectId: input.projectId, commentId: target.parentId }),
        );
      }),
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
              yield* save({
                ...previous,
                connected: true,
                account,
                lastSyncAt: null,
                error: null,
                retryAt: null,
              });
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
