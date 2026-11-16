import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE slack_send_attempts (
    command_id TEXT PRIMARY KEY, project_id TEXT NOT NULL,
    input_json TEXT NOT NULL, result_json TEXT NOT NULL
  )`;
});
