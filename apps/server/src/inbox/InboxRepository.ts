import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  CommandId,
  InboxError,
  InboxMutation,
  InboxReplyAttempt,
  InboxMutationResult,
  InboxNotification,
  InboxIrrelevanceReference,
  InboxState,
  ProjectId,
  type ThreadId,
} from "@t3tools/contracts";

const Receipt = Schema.Struct({
  commandId: CommandId,
  projectId: ProjectId,
  notificationId: Schema.String,
  action: Schema.optionalKey(InboxMutation),
  before: InboxState,
  after: InboxState,
  result: InboxMutationResult,
  undone: Schema.Boolean,
});
export type Receipt = typeof Receipt.Type;
export class InboxRepository extends Context.Service<
  InboxRepository,
  {
    readonly replyReceipt: (
      commandId: CommandId,
    ) => Effect.Effect<InboxReplyAttempt | null, InboxError>;
    readonly recordReply: (
      notification: InboxNotification,
      attempt: InboxReplyAttempt,
    ) => Effect.Effect<void, InboxError>;
    readonly forThread: (
      projectId: ProjectId,
      threadId: ThreadId,
    ) => Effect.Effect<InboxNotification | null, InboxError>;
    readonly get: (
      projectId: ProjectId,
      id: string,
    ) => Effect.Effect<InboxNotification | null, InboxError>;
    readonly list: (
      projectId: ProjectId,
      page?: {
        offset?: number;
        limit?: number;
        search?: string;
        threadId?: ThreadId;
        summaryReady?: boolean;
        showSelfUpdates?: boolean;
        showSelfReplies?: boolean;
        filterIrrelevant?: boolean;
        visibility?: "visible" | "filtered" | "all";
      },
    ) => Effect.Effect<ReadonlyArray<InboxNotification>, InboxError>;
    readonly relevanceSince: Effect.Effect<number, InboxError>;
    readonly references: (
      projectId: ProjectId,
      offset?: number,
    ) => Effect.Effect<ReadonlyArray<InboxIrrelevanceReference>, InboxError>;
    readonly history: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<InboxNotification>, InboxError>;
    readonly pending: Effect.Effect<ReadonlyArray<InboxNotification>, InboxError>;
    readonly pendingAnalysis: (
      projects: ReadonlyArray<ProjectId>,
    ) => Effect.Effect<ReadonlyArray<InboxNotification>, InboxError>;
    readonly pendingResearch: (
      projects: ReadonlyArray<ProjectId>,
    ) => Effect.Effect<ReadonlyArray<InboxNotification>, InboxError>;
    readonly put: (notification: InboxNotification) => Effect.Effect<void, InboxError>;
    readonly receipt: (commandId: CommandId) => Effect.Effect<Receipt | null, InboxError>;
    readonly commit: (
      notification: InboxNotification,
      receipt: Receipt,
      undone?: CommandId,
      reference?: InboxIrrelevanceReference,
    ) => Effect.Effect<void, InboxError>;
  }
>()("t3/inbox/InboxRepository") {}
const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const decode = Schema.decodeUnknownEffect(Schema.fromJsonString(InboxNotification));
  const encode = Schema.encodeEffect(Schema.fromJsonString(InboxNotification));
  const decodeReceipt = Schema.decodeUnknownEffect(Schema.fromJsonString(Receipt));
  const encodeState = Schema.encodeEffect(Schema.fromJsonString(InboxState));
  const encodeReceipt = Schema.encodeEffect(Schema.fromJsonString(Receipt));
  const failed = (cause: unknown) =>
    new InboxError({ detail: "Could not persist inbox state.", cause });
  const rows = <E>(query: Effect.Effect<ReadonlyArray<{ payload_json: string }>, E>) =>
    query.pipe(
      Effect.flatMap((records) => Effect.forEach(records, (row) => decode(row.payload_json))),
      Effect.mapError(failed),
    );
  const put = (notification: InboxNotification) =>
    encode(notification).pipe(
      Effect.flatMap(
        (
          json,
        ) => sql`INSERT INTO inbox_notifications (id, project_id, thread_id, updated_at, payload_json)
      VALUES (${notification.id}, ${notification.projectId}, ${notification.state.threadId}, ${notification.updatedAt}, ${json})
      ON CONFLICT(id) DO UPDATE SET thread_id=excluded.thread_id, updated_at=excluded.updated_at, payload_json=excluded.payload_json`,
      ),
      Effect.asVoid,
      Effect.mapError(failed),
    );
  const decodeReference = Schema.decodeUnknownEffect(
    Schema.fromJsonString(InboxIrrelevanceReference),
  );
  const encodeReference = Schema.encodeEffect(Schema.fromJsonString(InboxIrrelevanceReference));
  const decodeReply = Schema.decodeUnknownEffect(Schema.fromJsonString(InboxReplyAttempt));
  const encodeReply = Schema.encodeEffect(Schema.fromJsonString(InboxReplyAttempt));
  return InboxRepository.of({
    relevanceSince: sql<{
      started_at: number;
    }>`SELECT started_at FROM inbox_relevance_epoch WHERE id=1`.pipe(
      Effect.map((rows) => rows[0]!.started_at),
      Effect.mapError(failed),
    ),
    references: (projectId, offset = 0) =>
      sql<{
        payload_json: string;
      }>`SELECT current.payload_json FROM inbox_irrelevance_references AS current
      WHERE current.project_id=${projectId} AND NOT EXISTS (
        SELECT 1 FROM inbox_irrelevance_references AS newer WHERE newer.project_id=current.project_id
        AND newer.notification_id=current.notification_id AND newer.content_version=current.content_version
        AND newer.rowid>current.rowid
      ) ORDER BY current.rowid DESC LIMIT 100 OFFSET ${offset}`.pipe(
        Effect.flatMap((records) =>
          Effect.forEach(records, (row) => decodeReference(row.payload_json)),
        ),
        Effect.mapError(failed),
      ),
    replyReceipt: (commandId) =>
      sql<{
        result_json: string;
      }>`SELECT result_json FROM inbox_commands WHERE command_id=${commandId}`.pipe(
        Effect.flatMap((rows) =>
          rows[0] ? decodeReply(rows[0].result_json) : Effect.succeed(null),
        ),
        Effect.mapError(failed),
      ),
    recordReply: (notification, attempt) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            const json = yield* encodeReply(attempt);
            const state = yield* encodeState(notification.state);
            yield* put(notification);
            yield* sql`INSERT INTO inbox_commands(command_id,project_id,notification_id,before_json,after_json,result_json) VALUES(${attempt.commandId},${notification.projectId},${notification.id},${state},${state},${json}) ON CONFLICT(command_id) DO UPDATE SET result_json=excluded.result_json`;
          }),
        )
        .pipe(Effect.mapError(failed)),
    forThread: (projectId, threadId) =>
      rows(
        sql`SELECT payload_json FROM inbox_notifications WHERE project_id=${projectId} AND thread_id=${threadId} LIMIT 1`,
      ).pipe(Effect.map((items) => items[0] ?? null)),
    get: (projectId, id) =>
      rows(
        sql`SELECT payload_json FROM inbox_notifications WHERE project_id=${projectId} AND id=${id}`,
      ).pipe(Effect.map((items) => items[0] ?? null)),
    list: (projectId, page) => {
      const search = page?.search?.toLowerCase() ?? "";
      return rows(sql`SELECT payload_json FROM inbox_notifications WHERE project_id=${projectId}
        AND (${page?.summaryReady ?? false}=0 OR json_extract(payload_json, '$.analysis') IS NOT NULL OR json_extract(payload_json, '$.processingError') IS NOT NULL)
        AND (${page?.visibility === "all"}=1 OR coalesce((
          coalesce(json_extract(payload_json, '$.state.irrelevant'),0)=1
          OR (${page?.filterIrrelevant ?? true}=1 AND json_extract(payload_json, '$.state.irrelevant') IS NOT 0
            AND json_extract(payload_json, '$.relevance.status')='complete' AND json_extract(payload_json, '$.relevance.irrelevant')=1)
          OR (${page?.showSelfUpdates ?? true}=0 AND coalesce(json_extract(payload_json, '$.replyCursor.isSelf'),0)=1 AND coalesce(json_extract(payload_json, '$.replyCursor.kind'),'reply')='update')
          OR (${page?.showSelfReplies ?? true}=0 AND coalesce(json_extract(payload_json, '$.replyCursor.isSelf'),0)=1 AND coalesce(json_extract(payload_json, '$.replyCursor.kind'),'reply')='reply')
        ),0) IS ${page?.visibility === "filtered" ? 1 : 0})
        AND (${page?.threadId ?? null} IS NULL OR thread_id=${page?.threadId ?? null})
        AND (${search}='' OR instr(lower(coalesce(json_extract(payload_json, '$.analysis.summary'), '')), ${search}) > 0 OR EXISTS (
          SELECT 1 FROM json_each(inbox_notifications.payload_json, '$.items') AS item
          WHERE instr(lower(json_extract(item.value, '$.title') || ' ' || json_extract(item.value, '$.location') || ' ' || json_extract(item.value, '$.content')), ${search}) > 0
        ))
        ORDER BY CASE json_extract(payload_json, '$.state.placement') WHEN 'active' THEN 0 WHEN 'delegated' THEN 1 WHEN 'snoozed' THEN 2 ELSE 3 END, updated_at DESC, id
        LIMIT ${page ? Math.max(1, Math.min(page.limit ?? 100, 101)) : 500} OFFSET ${page?.offset ?? 0}`);
    },
    history: (projectId) =>
      rows(sql`SELECT payload_json FROM inbox_notifications WHERE project_id=${projectId}
      AND length(trim(coalesce(json_extract(payload_json, '$.confirmedOutcome'), ''))) > 0
      ORDER BY updated_at DESC LIMIT 500`),
    pending: rows(
      sql`SELECT payload_json FROM inbox_notifications WHERE json_extract(payload_json, '$.agentStatus') IN ('linking','starting','stop-requested') LIMIT 500`,
    ),
    pendingAnalysis: (projects) =>
      projects.length
        ? Effect.gen(function* () {
            const now = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
            return yield* rows(sql`SELECT payload_json FROM inbox_notifications WHERE ${sql.in("project_id", projects)}
        AND json_extract(payload_json, '$.analysis') IS NULL AND json_extract(payload_json, '$.processingError') IS NULL
        AND (json_extract(payload_json, '$.analysisRetryAt') IS NULL OR julianday(json_extract(payload_json, '$.analysisRetryAt')) <= julianday(${now}))
        ORDER BY updated_at ASC, id LIMIT 500`);
          })
        : Effect.succeed([]),
    pendingResearch: (projects) =>
      projects.length
        ? Effect.gen(function* () {
            const now = DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis));
            return yield* rows(sql`SELECT payload_json FROM inbox_notifications WHERE ${sql.in("project_id", projects)}
        AND json_extract(payload_json, '$.analysis') IS NOT NULL
        AND json_extract(payload_json, '$.suggestionResearch.status')='researching'
        AND (json_extract(payload_json, '$.suggestionResearch.retryAt') IS NULL OR julianday(json_extract(payload_json, '$.suggestionResearch.retryAt')) <= julianday(${now}))
        ORDER BY updated_at DESC, id LIMIT 100`);
          })
        : Effect.succeed([]),
    put,
    receipt: (commandId) =>
      sql<{
        result_json: string;
        undone: number;
      }>`SELECT result_json, undone FROM inbox_commands WHERE command_id=${commandId}`.pipe(
        Effect.flatMap((records) =>
          records[0]
            ? decodeReceipt(records[0].result_json).pipe(
                Effect.map((receipt) => ({ ...receipt, undone: records[0]!.undone === 1 })),
              )
            : Effect.succeed(null),
        ),
        Effect.mapError(failed),
      ),
    commit: (notification, receipt, undone, reference) =>
      sql
        .withTransaction(
          Effect.gen(function* () {
            yield* put(notification);
            const json = yield* encodeReceipt(receipt);
            const before = yield* encodeState(receipt.before);
            const after = yield* encodeState(receipt.after);
            yield* sql`INSERT INTO inbox_commands(command_id, project_id, notification_id, before_json, after_json, result_json)
        VALUES(${receipt.commandId}, ${receipt.projectId}, ${receipt.notificationId}, ${before}, ${after}, ${json})`;
            if (reference) {
              const referenceJson = yield* encodeReference(reference);
              yield* sql`INSERT INTO inbox_irrelevance_references(command_id,project_id,notification_id,content_version,payload_json)
                VALUES(${receipt.commandId},${notification.projectId},${notification.id},${notification.analysisVersion},${referenceJson})`;
            }
            if (undone) {
              yield* sql`UPDATE inbox_commands SET undone=1 WHERE command_id=${undone}`;
              yield* sql`DELETE FROM inbox_irrelevance_references WHERE command_id=${undone} AND project_id=${notification.projectId}`;
            }
          }),
        )
        .pipe(Effect.mapError(failed)),
  });
});
export const layer = Layer.effect(InboxRepository, make);
