import { VcsUnsupportedOperationError } from "@t3tools/contracts";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import * as Cache from "effect/Cache";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as SqlClient from "effect/sql/SqlClient";
import type { ProjectId } from "@t3tools/contracts";
import * as ServerSettings from "../serverSettings.ts";

/** Application policy; standalone Git utilities have no registered project preferences. */
export class GitIntegration extends Context.Reference<{
  readonly isProjectEnabled: (projectId: ProjectId) => Effect.Effect<boolean>;
  readonly isEnabled: (cwd: string) => Effect.Effect<boolean>;
}>("t3/project/GitIntegration", {
  defaultValue: () => ({
    isEnabled: () => Effect.succeed(true),
    isProjectEnabled: () => Effect.succeed(true),
  }),
}) {}

export const assertEnabled = Effect.fn("GitIntegration.assertEnabled")(function* (cwd: string) {
  const policy = yield* GitIntegration;
  if (!(yield* policy.isEnabled(cwd))) {
    return yield* new VcsUnsupportedOperationError({
      operation: "GitIntegration",
      kind: "git",
      detail:
        "Git integration is disabled for this project. Enable it in project settings to use Git features.",
    });
  }
});

const make = Effect.gen(function* () {
  const settingsService = yield* ServerSettings.ServerSettingsService;
  const sql = yield* SqlClient.SqlClient;
  const path = yield* Path.Path;
  const fs = yield* FileSystem.FileSystem;
  const normalize = (cwd: string) =>
    fs.realPath(cwd).pipe(Effect.orElseSucceed(() => path.resolve(cwd)));
  // Registered roots are stable. Reuse canonical paths instead of issuing an lstat
  // for every project and worktree for each Git command while any project is off.
  const canonicalRoots = yield* Cache.makeWith(normalize, {
    capacity: 2048,
    timeToLive: () => "1 minute",
  });

  const isEnabled = Effect.fn("GitIntegration.isEnabled")(
    function* (cwd: string) {
      const settings = yield* settingsService.getSettings;
      // Most installations have no opt-outs. Avoid path and database work on every Git spawn.
      if (
        settings.gitEnabled !== false &&
        !Object.values(settings.projectSettingsOverrides).some(
          (entry) => entry.gitEnabled === false,
        )
      )
        return true;
      const candidate = yield* normalize(cwd);
      const roots = yield* sql<{ projectId: ProjectId; root: string }>`
      SELECT project_id AS "projectId", workspace_root AS root
      FROM projection_projects WHERE deleted_at IS NULL
      UNION
      SELECT t.project_id AS "projectId", json_extract(t.payload_json, '$.worktreePath') AS root
      FROM orchestration_v2_projection_threads t
      JOIN projection_projects p ON p.project_id = t.project_id
      WHERE p.deleted_at IS NULL AND json_extract(t.payload_json, '$.worktreePath') IS NOT NULL
    `;
      let owner: { projectId: ProjectId; root: string } | undefined;
      for (const entry of roots) {
        const root = yield* Cache.get(canonicalRoots, entry.root);
        const relative = path.relative(root, candidate);
        if (
          relative !== "" &&
          (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
        )
          continue;
        if (owner === undefined || root.length > owner.root.length)
          owner = { projectId: entry.projectId, root };
      }
      return (
        resolveProjectSettings(settings, owner?.projectId ?? null).settings.gitEnabled !== false
      );
    },
    Effect.orElseSucceed(() => false),
  );
  const isProjectEnabled = (projectId: ProjectId) =>
    settingsService.getSettings.pipe(
      Effect.map((settings) => resolveProjectSettings(settings, projectId).settings.gitEnabled),
      Effect.orElseSucceed(() => false),
    );
  return { isEnabled, isProjectEnabled };
});

export const layer = Layer.effect(GitIntegration, make);
