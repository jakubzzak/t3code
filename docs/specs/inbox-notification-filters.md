# Inbox notification visibility filters

## Problem and outcome

Keep irrelevant acknowledgements and self-generated activity out of the Inbox
without treating them as resolved. Users can teach the relevance filter with
explicit examples, inspect retained notifications, and undo their decisions.

## Scope

The Inbox popover is the single place to choose which notifications to include.
Use two visible groups: **Sources** and **Include**. All three sources (Slack,
Linear, Superhuman) and **Unread** start checked. **Irrelevant**, **Last message
from me** and **Last update from me** start unchecked. There is no Clear filters
CTA. Selected sources combine with OR; explicitly deselecting every source shows
no notifications.

The Include choices are permissions for categories, not exclusive search facets.
Ordinary read, relevant incoming notifications form the base. Unchecking Unread
excludes unread items; checking Irrelevant admits irrelevant content; checking
either self-activity option admits that kind of own activity. Every applicable
category must be enabled: checking Unread cannot bypass an unchecked Irrelevant
or self-activity option. Enabling an Include option can add notifications without
removing the ordinary base results. A manual keep-relevant correction overrides
the automatic irrelevance decision.

These choices do not change placement, read state or source configuration. Apply
all predicates before pagination and include selections in query/cache identity.
Counts describe matching items and are withheld while any page is incomplete,
loading or failed. Automatically marking a selected notification read does not
remove it, because ordinary read items remain included; no focused-row exception
is needed.

Keep **Minimum confidence** and project-scoped **Saved references** under
**Settings → Features → Inbox relevance**. Remove the duplicate category switches
from Settings. Confidence is an integer from 75% through 100%, defaulting to 98%.
Only newly received content with successful summary preprocessing can acquire an
automatic decision. Old stored visibility preferences do not change the new
popover's default; retain legacy API behavior for older callers without rewriting
stored choices.

Web and desktop share this behavior. Native mobile Inbox UI remains deferred by
the [parent spec](project-notification-inbox.md). No source writes, sender muting,
separate classification model, or OS/push notification changes are included.

## Automatic relevance decisions

- Assess confidence that the incoming message is **both irrelevant and requires
  no input from the user**, in the same tool-free model call that generates its
  summary. No second model call or separate prompt editor is introduced.
- A message without a suggested reply can still be important. Requests,
  decisions, meaningful confirmations and security alerts must not become
  irrelevant merely because there is no suggested action. Sender or bot identity
  alone never determines relevance.
- Only new incoming content is eligible. Existing notifications, pending legacy
  summaries, imported historical messages, refreshes, replayed source activity,
  and explicit summary regeneration must not receive a retrospective decision.
  A genuinely new incoming reply in an existing conversation is new content.
- Capture the threshold for eligible incoming content. Later threshold changes
  and feedback affect future assessments, not historical decisions. An existing
  cached score must not be compared again against a newly selected threshold.
- When summary generation is disabled, fails, or cannot return a relevance
  assessment, include the notification under the normal summary delivery rules.
  Missing relevance metadata is never evidence of irrelevance.
- Publish the summary and relevance decision together. A stale summary result
  must not overwrite newer source content, a manual choice, or the threshold
  captured for a different content revision. Retries retain the existing bounded
  summary budget; they do not create another evaluation of completed content.

## Manual feedback and retained references

- With a notification row focused, **Cmd+I** (the platform modifier equivalent
  elsewhere) marks it irrelevant, immediately hides it from the normal Inbox,
  and saves an immutable example of the content the user judged. This also works
  for older notifications. Do not intercept editing, search, or composer input.
- Keep references within their originating project. They are independent of the
  optional confirmed-outcome Inbox memory feature, and survive later replies or
  summary changes to the original notification. Use bounded matching examples
  in future preprocessing; do not mute a whole sender or conversation.
- Retained filtered notifications remain discoverable through the Inbox filter
  view. A manual correction can keep a notification relevant; Undo restores the
  prior visibility and reverses that feedback operation, including its reference.
  Preserve idempotency and reject stale concurrent mutations.
- Saved references are inspectable beneath the Inbox relevance setting.
  Counts and content come from retained server state, not a client-only cache.
- Manual filtering does not settle, snooze, delete, disconnect, or alter the
  linked chat. Only explicit user resolution changes an item to Settled. Sending
  a reply, finishing an agent turn, or settling its linked chat does not resolve
  the notification. Existing explicit Settle/Un-settle actions remain available.

## Presentation

Use stacked dots at the left of each notification: preserve the unread dot,
add the irrelevant indication and a distinct ring for the user's last reply.
Below-threshold relevance can use a hollow indication. Do not add relevance
buttons, status chips, or explanatory text to the notification card.

Explain dots only through the same tooltip used for failed integration calls:
shared `TooltipPopup`, default themed surface, bottom placement, hoverable text,
and the integration status typography. The relevance tooltip includes Cmd+I.
Keep signals accessible to keyboard and assistive technology users; color alone
must not be the only available state description.

## Existing self-activity filters

The popover self-activity options are immediate, reversible view predicates,
independent of the prospective AI classifier. They include retained matching
notifications without polling, reprocessing summaries, or changing placement.
Ingestion and enabled background summaries continue for hidden records.

Identify the connected source user dynamically. For relayed status updates,
verify the integration's stable source identity; native actor IDs take precedence
and plain names require a unique match in complete source identity data. Unknown,
ambiguous or incomplete identities remain visible. Do not hard-code a person.

Evaluate source chronology, not fetch order. The last-reply category includes
replies accepted in Blackbird and ingested from the source application. A later
incoming reply makes the conversation eligible again, preserving its identity
and chat link. A self reply cannot reopen a settled notification; a genuinely
later incoming reply retains the existing reopening behavior.

An agent's response is incoming activity even when the user initiated its work.
An ordinary security alert remains eligible under these self-activity filters.

## Acceptance criteria

1. Replay representative existing records, including missing cursor/relevance
   fields and active, settled, delegated, summarized and failed-summary cohorts.
   Adding the relevance setting does not change historical visibility or state.
2. Process a fresh acknowledgement and a fresh actionable request through the
   summary path. Only confidence meeting the captured threshold can hide the
   acknowledgement. Threshold boundary values 75, 98 and 100 are enforced.
3. Change the threshold and add feedback after a completed assessment. Retained
   decisions do not change; the next incoming message uses the new configuration
   and relevant immutable examples. Replayed, stale and first-sync historical
   activity does not acquire an assessment.
4. Cmd+I hides the focused item, persists its original example and advances focus
   only after acceptance. Reload another client and inspect the reference. Undo
   restores the item and reverses the reference; rejected saves change neither.
5. A new incoming request in a manually filtered conversation is assessed afresh
   and can reappear. The earlier saved example still contains the old message.
   Concurrent analysis cannot overwrite a later manual choice or incoming reply.
6. The Sources and Include headings are visible and no Clear filters CTA exists.
   All sources and Unread start checked; irrelevant and both self-activity options
   start unchecked. Verify that enabling each Include option is monotonic, source
   selections combine with OR, an empty source selection shows none, and all
   applicable category permissions are required. Exercise pagination beyond 100
   rows, search, cache refresh, matching counts, manual correction and automatic
   read acknowledgement. Retired preferences do not alter the new defaults.
7. Send a reply to active and already-settled notifications. Preserve placement;
   the last-reply visibility rule may hide an unresolved item. Settle/reopen the
   linked chat and verify that notification placement remains unchanged.
8. Summary disabled/failure, unavailable score, retry, restart and permission
   denial remain recoverable without hiding an unassessed notification or
   sending extra model/source requests.
9. Inspect stacked signals and shared tooltips by hover, keyboard and narrow
   layout. Cmd+I never fires while typing. Settings group and nested controls
   retain accessible names and inherited global/read-only scope behavior.

## Compatibility and delivery

Extend existing services and typed permission-guarded commands; MCP callers and
scheduled work reach the same service behavior. Optional notification metadata
keeps older retained records readable. New clients default missing settings and
metadata safely. Preserve explicit false/null/missing meanings and source history.

Any reference/cutoff storage migration is additive. Do not backfill classifications
or repair live notifications. Native mobile Inbox, actual source sends, model
calibration, merge, release and production installation are outside this build.
