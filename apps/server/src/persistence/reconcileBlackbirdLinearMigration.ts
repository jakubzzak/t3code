import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";

/** Free upstream's V2 id only for the known fork migration; its column and data stay intact. */
export const reconcileBlackbirdLinearMigration = Effect.fn("reconcileBlackbirdLinearMigration")(
  function* () {
    const sql = yield* SqlClient.SqlClient;
    const tables =
      yield* sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'effect_sql_migrations'`;
    if (tables.length === 0) return;
    yield* sql`DELETE FROM effect_sql_migrations WHERE migration_id = 55 AND name = 'ProjectionThreadLinearIssue'`;
  },
);
