import { assert, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GitIntegration from "./GitIntegration.ts";

const layer = GitIntegration.layer.pipe(
  Layer.provideMerge(ServerSettings.layerTest()),
  Layer.provideMerge(SqlitePersistence.layerMemory),
  Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "git-integration-test-" })),
  Layer.provide(NodeServices.layer),
);

it.effect("applies current project preferences to nested paths and retained worktree threads", () =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const settings = yield* ServerSettings.ServerSettingsService;
    const policy = yield* GitIntegration.GitIntegration;
    const projectId = ProjectId.make("plain-workspace");
    yield* sql`INSERT INTO projection_projects
      (project_id, title, workspace_root, scripts_json, created_at, updated_at)
      VALUES (${projectId}, 'Plain workspace', '/work/plain', '[]', 'now', 'now')`;
    yield* sql`INSERT INTO projection_projects
      (project_id, title, workspace_root, scripts_json, created_at, updated_at)
      VALUES ('nested-repo', 'Nested repo', '/work/plain/repo', '[]', 'now', 'now')`;
    yield* sql`INSERT INTO orchestration_v2_projection_threads
      (thread_id, project_id, title, default_provider, runtime_mode, interaction_mode,
       created_at, updated_at, archived_at, payload_json)
      VALUES ('old-thread', ${projectId}, 'Old worktree', 'codex', 'full-access', 'default',
        'now', 'now', 'now', '{"worktreePath":"/old-root/worktree"}')`;
    assert.isTrue(yield* policy.isEnabled("/work/plain"));
    yield* settings.updateSettings({
      projectSettingsOverrides: { [projectId]: { gitEnabled: false } },
    });
    assert.isFalse(yield* policy.isEnabled("/work/plain/src"));
    assert.isFalse(yield* policy.isEnabled("/old-root/worktree/src"));
    assert.isTrue(yield* policy.isEnabled("/work/plain/repo"));
    assert.isTrue(yield* policy.isEnabled("/work/plain-other"));
    assert.isFalse(yield* policy.isProjectEnabled(projectId));
    const rejected = yield* GitIntegration.assertEnabled("/work/plain").pipe(Effect.exit);
    assert.strictEqual(rejected._tag, "Failure");
    yield* settings.updateSettings({
      projectSettingsOverrides: { [projectId]: { gitEnabled: true } },
    });
    assert.isTrue(yield* policy.isEnabled("/old-root/worktree"));
    const retained =
      yield* sql`SELECT * FROM orchestration_v2_projection_threads WHERE thread_id = 'old-thread'`;
    assert.strictEqual(retained.length, 1);
  }).pipe(Effect.provide(layer)),
);
