import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";
it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("Linear association migration", (it) => {
  it.effect("upgrades the fork's migration 55 without losing Linear links or skipping V2", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`ALTER TABLE projection_threads ADD COLUMN linked_linear_issue_json TEXT`;
      yield* sql`INSERT INTO effect_sql_migrations (migration_id, name) VALUES (55, 'ProjectionThreadLinearIssue')`;
      yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, created_at, updated_at, linked_linear_issue_json) VALUES ('linked-thread', 'project-1', 'Keep me', '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '{"id":"issue-1"}')`;
      yield* runMigrations();
      assert.deepEqual(
        yield* sql`SELECT linked_linear_issue_json FROM projection_threads WHERE thread_id = 'linked-thread'`,
        [{ linked_linear_issue_json: '{"id":"issue-1"}' }],
      );
      assert.deepEqual(yield* sql`SELECT name FROM effect_sql_migrations WHERE migration_id = 55`, [
        { name: "OrchestrationV2" },
      ]);
      assert.isAbove(
        (yield* sql`SELECT name FROM sqlite_master WHERE name LIKE 'orchestration_v2_%'`).length,
        0,
      );
      yield* runMigrations();
    }),
  );
  it.effect("adds optional issue storage without changing existing thread data", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 54 });
      yield* sql`INSERT INTO projection_threads (thread_id, project_id, title, model_selection_json, runtime_mode, created_at, updated_at) VALUES ('thread-1', 'project-1', 'Keep me', '{"instanceId":"codex","model":"gpt-5.4"}', 'full-access', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`;
      yield* runMigrations();
      const columns = yield* sql<{ name: string }>`PRAGMA table_info(projection_threads)`;
      assert.isTrue(columns.some((column) => column.name === "linked_linear_issue_json"));
      const rows =
        yield* sql`SELECT title, linked_linear_issue_json FROM projection_threads WHERE thread_id = 'thread-1'`;
      assert.deepEqual(rows, [{ title: "Keep me", linked_linear_issue_json: null }]);
    }),
  );
});
