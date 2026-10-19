import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE project_library_entries (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    search_text TEXT NOT NULL,
    entry_json TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    truncated INTEGER NOT NULL DEFAULT 0
  )`;
  yield* sql`CREATE INDEX project_library_recent ON project_library_entries(project_id, created_at DESC, id)`;
  yield* sql`CREATE TABLE project_home (
    project_id TEXT PRIMARY KEY,
    preferences_json TEXT,
    briefing_json TEXT,
    attempted_at INTEGER,
    generating INTEGER NOT NULL DEFAULT 0
  )`;
  yield* sql`CREATE TABLE project_home_visits (
    project_id TEXT NOT NULL,
    thread_id TEXT NOT NULL,
    opened_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, thread_id)
  ) WITHOUT ROWID`;
});
