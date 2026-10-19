# Refresh thread titles after context compression

## Problem and outcome

Long-running threads can move beyond their original subject while keeping an outdated
title. Reconsider the title after every completed context compression so users can
recognize the current work. Preserve useful titles, especially names chosen by the user.

## Scope

Cover automatic title reconsideration after both provider-initiated and user-requested
context compression. Apply the same behavior across web, desktop, and mobile, including
remote connections. Existing manual rename and explicit title regeneration remain
available. No new settings, title history UI, or changes to when compression occurs.

## Required behavior

- Each distinct completed compression triggers title reconsideration using the current
  conversation and existing title. Starting, failing, or canceling compression does not
  trigger it; duplicate delivery of a completion does not create another refresh.
- Reconsideration may keep the title exactly unchanged. Do not force new wording when
  the existing title still describes the work. Use the conversation's current purpose,
  rather than letting its initial topic dominate after a shift.
- A manual title carries much stronger preference than a generated title. Keep its
  exact wording while it remains relevant, including through implementation, debugging,
  testing, and related subtopics. A more polished or specific alternative is insufficient
  reason to replace it.
- Replace a manual title only when the conversation has clearly moved beyond its
  meaning. If relevance is ambiguous, keep it. Manual precedence has no fixed expiry
  and is not limited to skipping one compression; it also is not a permanent lock.
- Keeping a manual title must preserve its manual preference for future compressions.
  A later manual rename establishes the new preferred title.
- A manual rename made while generation is pending wins over that pending result.
  Stale results must not overwrite a newer title decision. Subsequent compressions may
  reconsider the newly chosen title under the same relevance rule.
- If title generation fails or lacks usable context, retain the current title and its
  preference. Title generation must not block the conversation or compression; the next
  completed compression remains eligible for reconsideration.

## Acceptance criteria

1. Two separate successful compressions each reconsider a generated title. An accurate
   title can remain unchanged both times; a later clear change in purpose produces a
   title describing the new work.
2. A manually named "Release preparation" thread retains that exact title across
   compressions during release debugging and testing, including minor topic detours.
   When the user explicitly abandons release work and uses the thread for an unrelated
   redesign, a subsequent compression can replace it with a relevant title.
3. An ambiguous shift preserves a manual title and its stronger preference through
   further compressions. A proposed wording improvement alone does not rename it.
4. A manual rename during pending generation is still visible after that result arrives,
   including when the rename came from another connected client.
5. Failed or canceled compression and duplicate completion notifications do not produce
   extra refreshes. Failed title generation leaves the existing title intact, and a later
   successful compression can refresh it. Connected clients observe the same final title.

## Constraints and decisions

Use the shared server title-generation flow and bounded conversation context. Preserve
the distinction between user-chosen and generated titles even when reconsideration
returns the same text. Relevance is a semantic judgment guided by the rules and examples
above; no numeric weighting or similarity threshold is agreed.

Provider integration must identify actual completed compression, including automatic
compression where the provider reports it. Do not infer completion from token usage or
ordinary turn completion. Assumption: providers that expose no reliable completion
signal are outside this trigger until such a signal is supported.

No blocking product questions remain.
