import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE IF NOT EXISTS inbox_notifications (
    id TEXT PRIMARY KEY, project_id TEXT NOT NULL, thread_id TEXT,
    updated_at TEXT NOT NULL, payload_json TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX IF NOT EXISTS inbox_project_updated ON inbox_notifications(project_id, updated_at DESC)`;
  yield* sql`CREATE INDEX IF NOT EXISTS inbox_thread ON inbox_notifications(thread_id)`;
  yield* sql`CREATE TABLE IF NOT EXISTS inbox_commands (
    command_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, notification_id TEXT NOT NULL,
    before_json TEXT NOT NULL, after_json TEXT NOT NULL, result_json TEXT NOT NULL,
    undone INTEGER NOT NULL DEFAULT 0
  )`;
});
