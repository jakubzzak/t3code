import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

// Records which missed fixed-time occurrences the last run caught up on.
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN last_run_missed_since TEXT`;
  yield* sql`ALTER TABLE scheduled_tasks ADD COLUMN last_run_missed_count INTEGER`;
});
