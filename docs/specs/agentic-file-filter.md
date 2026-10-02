# Agent-assisted file filtering

## Problem and outcome

Users reviewing changes need to narrow the file list without manually scanning unrelated files. Let them edit a filename regex directly or describe what they want to see and have an agent update it. Hide spec and test files initially, while making the active filter visible and easy to clear.

## Scope

Add the filter to both the PR Code tab and the regular Diff panel in web and desktop. Each chat (thread) owns two independent filter values, one for each view. Every new chat initializes both with the default; filters never become global preferences or carry over from another chat.

This changes file visibility, not file contents or review status. Filtering must not mark hidden files as viewed.

## Required behavior

- Place a filter icon beside the expand/collapse control in both views. It opens a small modal with the regex input above a single prompt line at the bottom. Keep the interface minimal, without a chat transcript.
- The regex means **show filenames matching this expression**. Apply it to the filename, not parent directories. Inclusion, exclusion, and combined requests must be expressible in the same field.
- Initialize each filter with `^(?!.*\.(spec|test)\.).*$`. This excludes filenames containing literal `.spec.` or `.test.` anywhere, regardless of prefix, suffix, or extension. The dots are not wildcards.
- Users can edit the regex manually. Valid edits update the visible files; an empty regex or Clear action shows all files. Invalid regex displays an inline error and leaves the last valid filter applied.
- Submitting the prompt asks the agent to update the regex. Include the current expression so requests such as “also hide snapshots” can refine it. Display the generated expression in the same editable field and apply it after validation.
- Disable regex editing while generation is running. Provide a Stop action. Completion, failure, or cancellation unlocks editing; failure or cancellation preserves the previous filter and reports the outcome inline. A late result must not overwrite a newer filter or affect another chat/view.
- Closing the modal does not clear the applied filter. Keep the toolbar icon visibly active while filtering, show the visible/total file count, and keep the filter accessible when no files match. A zero-match result is distinct from an empty diff.
- Editing or clearing PR Code's filter does not change Diff's filter, and vice versa. Retain both while using that chat in the current client session; each new chat always starts with the default. Restarting the app resets filters; they do not synchronize between devices.

## Acceptance criteria

1. A new chat hides `button.spec.ts`, `button.spec.tsx`, and `server.test.js` in both views. It keeps `button.ts`, `contest.ts`, and `buttonXspecYts` visible. A parent directory named `tests.spec.data` does not hide an otherwise matching filename.
2. A manual regex can show only selected filenames. Clearing it reveals every file. An invalid expression leaves the prior result visible with an error.
3. “Only TypeScript files, excluding tests” produces a displayed, valid regex that includes `button.ts` and excludes `button.test.ts` and `button.js`. Editing is disabled only while generation runs; stopping or failing preserves the prior filter.
4. Changing PR Code's filter leaves Diff unchanged. Another new chat starts with the default in both views, even if the previous chat cleared or customized its filters.
5. Closing and reopening the modal preserves its current filter. Hiding every file still leaves a visible filtered count and a working Clear action; viewed status is unchanged.

## Constraints and assumptions

- Reuse the existing toolbar conventions in [PullRequestCodeTab](../../apps/web/src/components/pullRequest/PullRequestCodeTab.tsx) and [DiffPanel](../../apps/web/src/components/DiffPanel.tsx). Filtering must keep the file tree and displayed diffs consistent, including files loaded later.
- Generation must work through the connected environment for local, remote, and tunnel clients. Server operations belong in services with typed contracts, not transport handlers. Filtering must remain responsive as the file list grows.
- Assumption: extend the existing [text-generation service](../../apps/server/src/textGeneration/TextGeneration.ts) and use the configured text-generation model, without a model picker in this modal. Provider support or fallback must be explicit for each adapter; manual filtering remains usable when generation is unavailable.

## Open questions

- The agreed placement covers the web/desktop toolbars. Native mobile placement and behavior need a scope decision before claiming feature parity.
