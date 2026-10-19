# Central worktree directory

## Problem and outcome

Keep newly created worktrees for all projects together in
`~/Developer/.worktrees/<project>/<branch>`, outside individual repository checkouts
and T3 application data. This location is included in the
[project Git integration spec](project-git-integration.md).

## Required behavior

- Use the existing machine-level **Worktree location** setting to select
  `~/Developer/.worktrees`. Do not hard-code a personal checkout path as the
  application default or change storage on other machines.
- Configure the current local app and the previously configured local dev environment
  separately through their normal settings persistence; they do not share settings.
- Ordinary and Linear issue worktree creation must honor the selected root, retaining
  their existing project and branch naming rules, including Linear project IDs.
- The new root is outside the repositories and needs no repository ignore rule.
  Retain `/.worktrees/` in T3 Code's `.gitignore` for any old nested checkouts.
- Existing worktrees remain in place. Reuse them at their registered paths, preserve
  uncommitted files, and retain existing cleanup support for previous locations.
- Invalid configured locations must fail new worktree creation with an actionable
  error. Reusing an existing worktree does not require a valid new location.

## Acceptance criteria

- With the central location configured, new ordinary and Linear worktrees are created
  beneath it, grouped by project.
- Selecting a Linear branch already checked out in the old location reuses that
  checkout without moving it or changing dirty files.
- A relative path or filesystem root is rejected before creating a Linear branch.
- The shared root is outside the T3 checkout. The previous nested `.worktrees/`
  location remains ignored by Git.

## Scope

No migration, deletion, new settings UI, or change to explicitly supplied worktree paths.
Application data remains in the existing T3 home. The setting takes effect for new
worktrees; installing a new application build is separate from merging this change.
