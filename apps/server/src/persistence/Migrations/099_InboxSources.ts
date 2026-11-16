import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE inbox_sources (project_id TEXT NOT NULL, source TEXT NOT NULL, payload_json TEXT NOT NULL, PRIMARY KEY(project_id, source))`;
});
