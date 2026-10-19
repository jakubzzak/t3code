import { DEFAULT_SERVER_SETTINGS, ProjectId, ServerSettings } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";
import {
  resolveNewThreadEnvMode,
  resolveProjectSettings,
  resolveWorktreeCleanup,
} from "./projectSettings.ts";

const projectId = ProjectId.make("plain-workspace");
const decodeSettings = Schema.decodeUnknownSync(ServerSettings);
const encodedDefaults = Schema.encodeSync(ServerSettings)(DEFAULT_SERVER_SETTINGS);
const settings = () =>
  decodeSettings({
    ...encodedDefaults,
    defaultThreadEnvMode: "worktree",
    projectSettingsOverrides: { [projectId]: { gitEnabled: false } },
  });

describe("project Git integration", () => {
  it("persists opt-out for one project and defaults other projects to enabled", () => {
    expect(resolveProjectSettings(settings(), projectId).settings.gitEnabled).toBe(false);
    expect(
      resolveProjectSettings(settings(), ProjectId.make("another-project")).settings.gitEnabled,
    ).toBe(true);
  });

  it("starts ordinary threads locally without erasing the retained worktree preference", () => {
    const projectSettings = resolveProjectSettings(settings(), projectId, null, null);
    expect(
      resolveNewThreadEnvMode({
        projectSettings,
        workspaceRoot: "/workspace",
        newProjectsRoot: null,
        projectHasThreads: true,
      }),
    ).toBe("local");
    expect(projectSettings.settings.defaultThreadEnvMode).toBe("worktree");
  });

  it("retains existing worktrees even when automatic deletion is configured", () => {
    const current = settings();
    const rules = resolveWorktreeCleanup(
      {
        ...current,
        storageCleanup: {
          ...current.storageCleanup,
          worktreeOnDelete: true,
          worktreeOnMerge: true,
          worktreeUnchanged: true,
          worktreeAfterDays: 1,
          worktreeSettledAfterDays: 0,
        },
      },
      projectId,
    );
    expect(rules).toMatchObject({
      worktreeOnDelete: false,
      worktreeOnMerge: false,
      worktreeUnchanged: false,
      worktreeAfterDays: null,
      worktreeSettledAfterDays: null,
    });
  });
});
