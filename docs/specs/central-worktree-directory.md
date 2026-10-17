# Central worktree directory

## Problem and outcome

Keep newly created worktrees for all projects together under the main T3 Code checkout,
in `~/Developer/t3code/.worktrees/<project>/<branch>`, excluded from Git.

## Required behavior

- Use the existing machine-level **Worktree location** setting to select
  `~/Developer/t3code/.worktrees`. Do not hard-code a personal checkout path as the
  application default or change storage on other machines.
- Ordinary and Linear issue worktree creation must honor the selected root, retaining
  their existing project and branch naming rules, including Linear project IDs.
- Add `/.worktrees/` to T3 Code's `.gitignore`.
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
- Files beneath the checkout's `.worktrees/` directory are ignored by Git.

## Scope

No migration, deletion, new settings UI, or change to explicitly supplied worktree paths.
Application data remains in the existing T3 home. The setting takes effect for new
worktrees; installing a new application build is separate from merging this change.
