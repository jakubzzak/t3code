import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE inbox_relevance_epoch (id INTEGER PRIMARY KEY CHECK(id=1), started_at INTEGER NOT NULL)`;
  yield* sql`INSERT INTO inbox_relevance_epoch(id, started_at) VALUES(1, ${yield* Clock.currentTimeMillis})`;
  yield* sql`CREATE TABLE inbox_irrelevance_references (
    command_id TEXT PRIMARY KEY, project_id TEXT NOT NULL, notification_id TEXT NOT NULL,
    content_version INTEGER NOT NULL, payload_json TEXT NOT NULL
  )`;
  yield* sql`CREATE INDEX inbox_irrelevance_project ON inbox_irrelevance_references(project_id, notification_id, content_version)`;
});
