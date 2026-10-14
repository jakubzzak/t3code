import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";
it.layer(NodeSqliteClient.layer({ filename: ":memory:" }))("Linear association migration", (it) => {
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
