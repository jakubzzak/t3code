import {
  ProjectHomeError,
  type ProjectId,
  ProjectLibraryEntry,
  ProjectBriefing,
  EMPTY_PROJECT_BRIEFING,
  ProjectHomePreferences,
  DEFAULT_PROJECT_HOME_PREFERENCES,
  type ThreadId,
  type ProjectLibraryListInput,
} from "@t3tools/contracts";
import * as KeyedLock from "@t3tools/shared/KeyedLock";
import * as DateTime from "effect/DateTime";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/sql/SqlClient";
import {
  createDeterministicAttachmentId,
  parseAttachmentUuid,
  resolveAttachmentPathById,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";

export interface RetainProjectUpload {
  readonly projectId: ProjectId;
  readonly attachmentId: string;
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export class ProjectHomeStore extends Context.Service<
  ProjectHomeStore,
  {
    readonly retainUpload: (
      input: RetainProjectUpload,
    ) => Effect.Effect<ProjectLibraryEntry, ProjectHomeError>;
    readonly list: (
      projectId: ProjectId,
      query?: string,
    ) => Effect.Effect<ReadonlyArray<ProjectLibraryEntry>, ProjectHomeError>;
    readonly claimBriefing: (projectId: ProjectId) => Effect.Effect<boolean, ProjectHomeError>;
    readonly finishBriefing: (
      projectId: ProjectId,
      briefing: ProjectBriefing | null,
    ) => Effect.Effect<void, ProjectHomeError>;
    readonly briefing: (projectId: ProjectId) => Effect.Effect<ProjectBriefing, ProjectHomeError>;
    readonly page: (
      input: ProjectLibraryListInput,
    ) => Effect.Effect<
      { entries: ReadonlyArray<ProjectLibraryEntry>; total: number },
      ProjectHomeError
    >;
    readonly get: (
      projectId: ProjectId,
      id: string,
    ) => Effect.Effect<
      { entry: ProjectLibraryEntry; content: string; truncated: boolean } | null,
      ProjectHomeError
    >;
    readonly save: (
      entry: ProjectLibraryEntry,
      content: string,
      truncated: boolean,
    ) => Effect.Effect<void, ProjectHomeError>;
    readonly preferences: (
      projectId: ProjectId,
    ) => Effect.Effect<ProjectHomePreferences, ProjectHomeError>;
    readonly updatePreferences: (
      projectId: ProjectId,
      preferences: ProjectHomePreferences,
    ) => Effect.Effect<void, ProjectHomeError>;
    readonly visit: (
      projectId: ProjectId,
      threadId: ThreadId,
    ) => Effect.Effect<void, ProjectHomeError>;
    readonly recentThreads: (
      projectId: ProjectId,
    ) => Effect.Effect<ReadonlyArray<ThreadId>, ProjectHomeError>;
  }
>()("t3/project/ProjectHomeStore") {}

const encodeEntry = Schema.encodeSync(Schema.fromJsonString(ProjectLibraryEntry));
const encodeBriefing = Schema.encodeSync(Schema.fromJsonString(ProjectBriefing));
const encodePreferences = Schema.encodeSync(Schema.fromJsonString(ProjectHomePreferences));

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const config = yield* ServerConfig.ServerConfig;
  const locks = yield* KeyedLock.make<string>();
  const decodeEntry = Schema.decodeUnknownEffect(Schema.fromJsonString(ProjectLibraryEntry));
  const decodeBriefing = Schema.decodeUnknownEffect(Schema.fromJsonString(ProjectBriefing));
  const decodePreferences = Schema.decodeUnknownEffect(
    Schema.fromJsonString(ProjectHomePreferences),
  );
  const error = (projectId: ProjectId, operation: string) => (cause: unknown) =>
    new ProjectHomeError({ projectId, operation, cause });
  yield* sql`UPDATE project_library_entries SET entry_json = json_set(entry_json, '$.status', 'failed')
    WHERE json_extract(entry_json, '$.status') = 'processing'`;
  // A process restart interrupts its workers, but does not reset the attempt's hourly budget.
  yield* sql`UPDATE project_home SET generating = 0,
    briefing_json = json_set(COALESCE(briefing_json, ${encodeBriefing(EMPTY_PROJECT_BRIEFING)}), '$.status', 'failed')
    WHERE generating = 1`;

  const briefing = (projectId: ProjectId) =>
    Effect.gen(function* () {
      const rows = yield* sql<{
        briefing_json: string | null;
        attempted_at: number | null;
        generating: number;
      }>`
      SELECT briefing_json, attempted_at, generating FROM project_home WHERE project_id = ${projectId}`;
      const row = rows[0];
      if (!row) return EMPTY_PROJECT_BRIEFING;
      const previous = row.briefing_json
        ? yield* decodeBriefing(row.briefing_json)
        : EMPTY_PROJECT_BRIEFING;
      return {
        ...previous,
        attemptedAt:
          row.attempted_at === null
            ? null
            : DateTime.formatIso(DateTime.makeUnsafe(row.attempted_at)),
        status: row.generating ? ("generating" as const) : previous.status,
      };
    }).pipe(
      Effect.mapError(
        (cause) => new ProjectHomeError({ projectId, operation: "read briefing", cause }),
      ),
    );

  return ProjectHomeStore.of({
    page: (input) =>
      Effect.gen(function* () {
        const query = (input.query ?? "").toLowerCase();
        const rows = yield* sql<{
          entry_json: string;
        }>`SELECT entry_json FROM project_library_entries
        WHERE project_id = ${input.projectId} AND instr(search_text, ${query}) > 0
        ORDER BY created_at DESC, id LIMIT ${input.limit ?? 50} OFFSET ${input.offset ?? 0}`;
        const count = yield* sql<{
          total: number;
        }>`SELECT COUNT(*) AS total FROM project_library_entries
        WHERE project_id = ${input.projectId} AND instr(search_text, ${query}) > 0`;
        return {
          entries: yield* Effect.forEach(rows, (row) => decodeEntry(row.entry_json)),
          total: count[0]?.total ?? 0,
        };
      }).pipe(Effect.mapError(error(input.projectId, "search library"))),
    get: (projectId, id) =>
      Effect.gen(function* () {
        const rows = yield* sql<{
          entry_json: string;
          content: string;
          truncated: number;
        }>`SELECT entry_json, content, truncated
        FROM project_library_entries WHERE project_id = ${projectId} AND id = ${id}`;
        const row = rows[0];
        return row
          ? {
              entry: yield* decodeEntry(row.entry_json),
              content: row.content,
              truncated: row.truncated === 1,
            }
          : null;
      }).pipe(Effect.mapError(error(projectId, "read library item"))),
    save: (entry, content, truncated) =>
      sql`INSERT INTO project_library_entries
      (id, project_id, created_at, search_text, entry_json, content, truncated)
      VALUES (${entry.id}, ${entry.projectId}, ${entry.createdAt}, ${[entry.title, entry.originalName, ...entry.labels].join(" ").toLowerCase()}, ${encodeEntry(entry)}, ${content}, ${truncated ? 1 : 0})
      ON CONFLICT(id) DO UPDATE SET search_text = excluded.search_text, entry_json = excluded.entry_json,
        content = excluded.content, truncated = excluded.truncated
      WHERE project_library_entries.project_id = excluded.project_id`.pipe(
        Effect.asVoid,
        Effect.mapError(error(entry.projectId, "save library item")),
      ),
    preferences: (projectId) =>
      Effect.gen(function* () {
        const rows = yield* sql<{
          preferences_json: string | null;
        }>`SELECT preferences_json FROM project_home WHERE project_id = ${projectId}`;
        return rows[0]?.preferences_json
          ? yield* decodePreferences(rows[0].preferences_json)
          : DEFAULT_PROJECT_HOME_PREFERENCES;
      }).pipe(Effect.mapError(error(projectId, "read home preferences"))),
    updatePreferences: (projectId, preferences) =>
      sql`INSERT INTO project_home(project_id, preferences_json)
      VALUES (${projectId}, ${encodePreferences(preferences)})
      ON CONFLICT(project_id) DO UPDATE SET preferences_json = excluded.preferences_json`.pipe(
        Effect.asVoid,
        Effect.mapError(error(projectId, "save home preferences")),
      ),
    visit: (projectId, threadId) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        yield* sql`INSERT INTO project_home_visits(project_id, thread_id, opened_at) VALUES (${projectId}, ${threadId}, ${now})
        ON CONFLICT(project_id, thread_id) DO UPDATE SET opened_at = excluded.opened_at`;
      }).pipe(Effect.mapError(error(projectId, "record opened chat"))),
    recentThreads: (projectId) =>
      sql<{ thread_id: ThreadId }>`SELECT thread_id FROM project_home_visits
      WHERE project_id = ${projectId} ORDER BY opened_at DESC, thread_id LIMIT 5`.pipe(
        Effect.map((rows) => rows.map((row) => row.thread_id)),
        Effect.mapError(error(projectId, "read recent chats")),
      ),
    claimBriefing: (projectId) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis;
        const claimed = yield* sql`INSERT INTO project_home(project_id, attempted_at, generating)
        VALUES (${projectId}, ${now}, 1)
        ON CONFLICT(project_id) DO UPDATE SET attempted_at = excluded.attempted_at, generating = 1
        WHERE project_home.generating = 0
          AND (project_home.attempted_at IS NULL OR project_home.attempted_at <= ${now - 3_600_000})
        RETURNING project_id`;
        return claimed.length === 1;
      }).pipe(
        Effect.mapError(
          (cause) => new ProjectHomeError({ projectId, operation: "start briefing", cause }),
        ),
      ),
    finishBriefing: (projectId, result) =>
      Effect.gen(function* () {
        const previous = yield* briefing(projectId);
        const next: ProjectBriefing = {
          ...(result ?? previous),
          attemptedAt: previous.attemptedAt,
          status: result ? "ready" : "failed",
        };
        yield* sql`UPDATE project_home SET generating = 0, briefing_json = ${encodeBriefing(next)} WHERE project_id = ${projectId}`;
      }).pipe(
        Effect.mapError(
          (cause) => new ProjectHomeError({ projectId, operation: "save briefing", cause }),
        ),
      ),
    briefing,
    retainUpload: (input) =>
      locks
        .withLock(
          input.attachmentId,
          Effect.gen(function* () {
            if (!parseAttachmentUuid(input.attachmentId))
              return yield* new ProjectHomeError({
                projectId: input.projectId,
                operation: "validate upload id",
              });
            const id = createDeterministicAttachmentId(
              "library",
              `${input.projectId}:${input.attachmentId}`,
            )!;
            const existing = yield* sql<{
              entry_json: string;
            }>`SELECT entry_json FROM project_library_entries WHERE id = ${id}`;
            if (existing[0]) return yield* decodeEntry(existing[0].entry_json);
            const source = resolveAttachmentPathById({
              attachmentsDir: config.attachmentsDir,
              attachmentId: input.attachmentId,
            });
            if (!source)
              return yield* new ProjectHomeError({
                projectId: input.projectId,
                operation: "find upload",
              });
            const extension = path.extname(source);
            const attachmentId = `${id}-${extension.slice(1)}`;
            const target = path.join(config.attachmentsDir, `${attachmentId}${extension}`);
            // This namespace is neither pending nor thread-owned. Legacy cleanup also leaves it alone.
            // Never overwrite an original when an upload request is retried.
            if (!(yield* fs.exists(target))) {
              yield* fs.copyFile(source, `${target}.part`);
              yield* fs.rename(`${target}.part`, target);
            }
            const entry: ProjectLibraryEntry = {
              id,
              projectId: input.projectId,
              kind: "file",
              originalName: input.name,
              attachmentId,
              mimeType: input.mimeType,
              sizeBytes: input.sizeBytes,
              url: null,
              title: input.name,
              summary: "",
              labels: [],
              status: "processing",
              createdAt: DateTime.formatIso(yield* DateTime.now),
            };
            yield* sql`INSERT INTO project_library_entries (id, project_id, created_at, search_text, entry_json)
        VALUES (${id}, ${input.projectId}, ${entry.createdAt}, ${input.name.toLowerCase()}, ${encodeEntry(entry)})
        ON CONFLICT(id) DO NOTHING`;
            return entry;
          }),
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new ProjectHomeError({
                projectId: input.projectId,
                operation: "retain upload",
                cause,
              }),
          ),
        ),
    list: (projectId, query = "") =>
      Effect.gen(function* () {
        const rows = yield* sql<{
          entry_json: string;
        }>`SELECT entry_json FROM project_library_entries
        WHERE project_id = ${projectId} AND instr(search_text, ${query.toLowerCase()}) > 0
        ORDER BY created_at DESC, id LIMIT 100`;
        return yield* Effect.forEach(rows, (row) => decodeEntry(row.entry_json));
      }).pipe(
        Effect.mapError(
          (cause) => new ProjectHomeError({ projectId, operation: "list library", cause }),
        ),
      ),
  });
});

export const layer = Layer.effect(ProjectHomeStore, make);
