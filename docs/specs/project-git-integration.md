# Project Git integration and shared worktree location

## Problem and outcome

Some projects are plain workspaces rather than Git-oriented development projects. Users need to work with agents and files without repository details, controls, or background Git activity throughout the project's experience.

For projects that use Git, keep new worktrees together under `~/Developer/.worktrees/<project>/<branch>`, outside individual repository checkouts and T3 application data.

## Scope

Add a per-project **Git integration** setting, on by default, across web, desktop, and mobile. It controls T3's integration for the project and all its threads, including threads using existing worktrees. It does not uninstall Git, remove a repository, or restrict an agent or user from explicitly running Git through a shell.

Include configuring the existing environment-level **Worktree location** to `~/Developer/.worktrees` on this machine. This is a local configuration choice, not a new application default or a change to other machines. Existing worktrees remain at their current paths.

## Required behavior

- Project settings expose the toggle even when integration is off. Explain beside it that disabling integration also disables Git-backed file checkpoints and restore. Existing projects without a saved value retain today's enabled behavior; enabling integration does not itself initialize a repository.
- Save the choice for the project in its environment. All clients connected to that environment use the same value, including remote, relay, and tunnel connections. Reopening the project or restarting the server preserves it. Other projects retain their own settings.
- While off, hide project Git status, branch information and selectors, repository diffs and change counts, commit/push/pull actions, PR controls, worktree creation, and dependent Git settings. Apply this throughout chat, the sidebar, settings, context menus, and the command palette. Git keybindings must not execute hidden actions. Keep the integration toggle available as the way back.
- Stop T3's automatic Git work for that project, including status refreshes, fetch/pull, PR discovery or monitoring, automatic worktree cleanup, and checkpoint capture. Queued work must respect the current setting before starting. Turning Git off must not produce recurring Git errors or leave turns waiting for checkpoints that will never be created.
- Make T3's Git-dependent operations unavailable consistently at the service boundary, including calls from stale clients, MCP tools, and scheduled work. Reject an explicitly requested unavailable operation with an explanation that Git integration is disabled. Ordinary agent work and file access continue across providers; explicit shell Git commands remain outside this setting's enforcement.
- New ordinary threads use the project's directory while integration is off, even if the saved default normally creates a worktree. Existing threads keep their working directories. Preserve repositories, dirty files, branches, worktrees, existing checkpoint data, and saved Git preferences when toggling the setting.
- Hide and disable Git-backed file restore and checkpoint diffs while off. Conversation history and agent messages remain available; there is no requirement to scrub Git text from past messages or tool output.
- Turning integration back on restores the project's Git features and automatic behavior according to its retained settings and current repository state. Resume checkpoint capture for future work; do not fabricate checkpoints or per-turn diffs for the disabled interval.
- If saving fails, show the error without presenting the change as saved. After reconnecting, display the server's persisted value.
- With Git integration enabled, new ordinary and Linear worktrees use the configured shared root, retaining the existing project and branch naming rules. Scheduled and delegated worktree creation must honor the same setting. Reuse existing checkouts at their registered paths; do not move, delete, or recreate them to match the new root. Explicitly supplied worktree paths retain their existing meaning.
- Apply the shared location to the current local app environment and the previously configured local dev environment, each through its normal settings persistence. Settings belong to environments; configuring one does not configure the other. Preserve unrelated preferences and retained worktree roots used for existing-worktree management.

## Acceptance criteria

1. An existing project without this setting behaves as before. Disable integration for one project: its Git UI disappears across connected clients, while another enabled project keeps its Git features. The toggle remains reachable.
2. In both a plain directory and an existing repository, start and complete an agent turn with integration off. Chat and file work succeed without Git prompts, new worktrees, checkpoint creation, or checkpoint-related failures. Background Git activity stops, and hidden actions cannot be triggered through keybindings or stale integration requests.
3. Disable integration on a project with dirty files and an existing worktree thread. Its files, repository, checkpoint data, and thread working directory remain intact. File restore is unavailable, and new ordinary threads use the project directory.
4. Restart or reconnect from another client: the disabled state persists. Re-enable it: Git features return using retained preferences and current repository state, without claiming checkpoint coverage for turns performed while disabled.
5. A failed settings write is visible and does not become a falsely persisted state. Explicitly asking an agent to run a Git shell command remains possible while T3 integration is disabled.
6. In each configured local environment, a Git-enabled project creates new worktrees under `~/Developer/.worktrees`, grouped by project, through ordinary, Linear, scheduled, and delegated creation paths. Selecting an existing worktree elsewhere reuses it without moving it or changing dirty files. A Git-disabled project creates no worktree regardless of the configured location.

## Constraints and decisions

- Use the existing project settings and permissions conventions; this is an environment-owned project choice, not a client-only display preference. Shared contracts and server behavior must agree across clients.
- [Checkpoint storage](../../apps/server/src/checkpointing/CheckpointStore.ts) uses Git-backed snapshots. Disabling checkpoints and file restore is intentional; adding a non-Git snapshot system is outside scope.
- Suppress unnecessary work at its source rather than continuing background Git activity behind hidden UI. Scheduled and delegated paths must honor the same project choice as interactive paths.
- The shared root supersedes the earlier choice of `~/Developer/t3code/.worktrees`; see [Central worktree directory](central-worktree-directory.md). Its location outside repositories avoids nesting unrelated projects inside the T3 checkout. No new repository ignore rule is needed for `~/Developer/.worktrees`; retain the existing `/.worktrees/` exclusion for any old checkouts beneath the T3 repository.

## Assumptions

- A Git operation already executing when the setting is saved may finish safely. Disabling integration prevents subsequent operations from starting; it does not require interrupting a Git process midway through a filesystem mutation.
