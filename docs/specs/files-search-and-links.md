# Files search and symbolic links

## Problem and outcome

Users cannot reliably find local configuration files in the Files panel: filename search excludes gitignored paths, and directory browsing omits symbolic links. Show links in their workspace context and let users explicitly include ignored files and tests in filename search, without scanning dependencies.

## Scope

Change the Files panel's directory browsing, filename/path search, and linked-file previews. The agreed visual design is the existing web/desktop Files panel with a search-options popover. Content search, PR/diff filtering, composer suggestions, and agent permissions are not changed by these view controls.

Manual browsing includes ignored files, tests, and symbolic links regardless of search options. Keep Git's internal `.git` directory excluded. This feature does not add editing outside the workspace or persistent search preferences.

## Required behavior

### Search options

- Add a search-options icon beside the existing search field and expand/collapse control. It opens a compact popover containing **Include ignored files** and **Include test files**, with the note **node_modules is always excluded**. Keep the existing refresh, Files tab, and layout controls.
- **Include ignored files** starts on and **Include test files** starts off in every chat. Changes apply immediately to the current filename query and remain reversible. They are temporary chat-local view state, not project defaults, persisted settings, or preferences shared with another chat/device. Closing the popover does not reset them. A client reload restores these defaults.
- Indicate on the options icon when either switch is enabled. Keep the controls reachable when there are no results; support keyboard activation, named switch states, and Escape to close and return focus.
- With **Include ignored files** off, search respects Git ignore rules. With it on, ignored files and directories become searchable, except the fixed exclusions below. Preserve ignored-file styling.
- With **Include test files** off, exclude basenames containing literal, case-sensitive `.test.` or `.spec.`, matching the current web PR/diff default in [fileFilterStore](../../apps/web/src/fileFilterStore.ts). This applies across extensions, not to parent-directory names or arbitrary occurrences of `test` and `spec`. Turning it on removes only this exclusion.
- The switches compose: a file that is both ignored and a test requires both enabled. Directory entries already loaded by manual browsing must not bypass the active search filters.
- Never index or return `node_modules` or its descendants in filename search, at any depth, regardless of either switch. Prune these directories before scanning, including symbolic-link aliases whose resolved targets are inside them. Keep them manually browsable. Keep `.git` and aliases into its internals excluded. Do not introduce blanket exclusions for `dist`, `build`, or other ignored directories.
- Clearing the query returns to manual browsing without these search-only exclusions. Changing filters must invalidate incompatible results; a late response for an earlier query or filter state must not replace the current results.

### Links and previews

- Show symbolic links to files and directories in manual browsing and eligible filename results, preserving their workspace-relative alias paths. Linked folders expand and their descendants can be found through filename search, subject to the same exclusions.
- Retain the normal file/folder icon and add the selected small bent forward-arrow overlay. The tooltip shows the link target only, without “read-only.” Identify links accessibly as well as visually.
- Follow links to targets outside the workspace for directory browsing, filename search, and file preview on the connected environment. External targets are read-only: the client must not offer mutations to them through this flow, and server-side mutation checks must continue to reject writes through such links. Links within the workspace retain existing applicable permissions.
- Keep broken or inaccessible links visible with an unavailable-target state instead of silently dropping them or presenting an empty file. Refresh retries resolution. Detect link cycles and stop recursive expansion/search at the cycle without freezing the panel or hiding unrelated results.

## Acceptance criteria

1. In a new chat, searching `.env` finds both `.env.example` and an ignored `.env`. Disabling ignored files hides `.env`; enabling it reveals that search result again. Clearing the query and manually opening the folder shows both, including when `.env` is a symbolic link.
2. Searching `button` initially excludes `button.test.ts` and `button.spec.tsx`; enabling test files reveals them. `contest.ts`, `buttonXspecYts`, and `tests.spec.data/button.ts` remain eligible under the default rule. An ignored `button.test.ts` appears only with both switches on.
3. Searching after manually visiting ignored/test files still respects both switches. A new chat and a reloaded client start with ignored files on and test files off. Closing/reopening the popover in the current chat preserves the temporary selection.
4. A large nested `node_modules` tree is never traversed by filename indexing/search, including through a differently named symlink and with both switches enabled. Manual browsing can still open it. A match elsewhere remains discoverable without waiting for dependency traversal.
5. `.env -> ../shared/.env` previews the external target read-only, displays the bent arrow, and has a target-only tooltip. A linked external folder can be expanded and searched through its alias; write attempts through it remain rejected. Broken, inaccessible, and cyclic links do not hang discovery or disappear without explanation.
6. Rapid query/toggle changes do not show stale or disallowed results. The same browsing, search, and external-link restrictions hold when the workspace is on a remote or tunneled environment.

## Constraints and assumptions

- Directory listing, indexed filename search, and file reads currently take different paths. The behavior must be consistent across them without changing content-search policy or silently changing other consumers of the shared search service. Apply result filtering before limits so excluded matches do not crowd out eligible files.
- Keep filesystem discovery on the owning environment and expose needed options/link metadata through typed contracts and reusable services. Clients must not interpret remote targets as paths on their own machine. Preserve existing access checks; this is not an expansion of provider or agent authority.
- Bound traversal and request work, stop cycles, and keep refresh/search responsive. If an index is still scanning or results are limited, make incomplete results explicit rather than claiming there are no matches.
- Assumption from repository multi-surface guidance: native mobile's corresponding Files flow receives equivalent search switches, link indication, and read-only external previews using its native controls. The selected popover placement applies to web/desktop; no mobile layout redesign is required. Native mobile's broader PR test classifier does not replace the agreed basename rule for this Files search.

## Open questions

No blocking questions. Client-reload reset and native mobile presentation are labeled assumptions above.

## Accepted security risks

### SEC-001 — Filesystem path replacement between validation and I/O (P2 / Medium)

- **Accepted scope:** the pre-existing read/write race in `apps/server/src/workspace/WorkspaceFileSystem.ts`, at reviewed head `03e4f1cb8651c574afba1f6d8f7b8c3225e3b55e` (PR [#39](https://github.com/jakubzzak/t3code/pull/39)); acceptance covers both text reads and writes.
- **Prerequisites and impact:** a local process able to replace a workspace file during an authorized read/save can swap it for a symlink after canonical containment validation but before the path-based open/write. A read can return unintended outside contents; a write can overwrite an outside file. The target must be accessible to the server process. This is not an unauthenticated network exploit or an expansion of the caller's RPC permission.
- **Evidence:** an isolated deterministic regression test swapped the checked file at the boundary before `writeFileString`; the outside fixture changed from `original` to `changed`. A companion test swapped the file before text open and returned `outside private contents` rather than `inside`. Both tests failed against both the reviewed head and the base implementation at `d55e672611b57ecad0e8611fd2fe8dd628c1573a`, establishing pre-existing provenance.
- **Residual risk and mitigations:** static external file and parent links are rejected for writes by the new canonical containment check; normal relative reads without link opt-in also reject static external links; filesystem-write authorization and host OS permissions still apply. Those controls do not close concurrent path-replacement races. Race-resistant descriptor-based I/O and regression coverage would be the corrective direction.
- **Decision:** Jakub explicitly replied “Explicitly accept SEC-001” on 2026-10-24 to this thread's question describing the save/write race, then explicitly replied “Also accept the read race” to the follow-up describing text-read redirection. No rationale, owner, expiry, or follow-up commitment was provided. This records acceptance, not a fix or merge approval.
- **Disposition:** accepted and recorded for both paths, with no implementation remediation requested in this review. Expanded exposure or changed mitigations require reconsidering this scoped acceptance.
