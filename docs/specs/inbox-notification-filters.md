# Inbox notification visibility filters

## Problem and outcome

The Inbox includes updates the user already knows about: an integration reports
that they resolved an issue, or a conversation resurfaces after they reply in the
source application. Let the user hide these categories while retaining useful
incoming replies and alerts, with immediate, reversible changes to visibility.

## Scope

Add two global Inbox settings, applying to all projects without project overrides:

- **Show updates caused by me** — on by default.
- **Show conversations where the last reply is mine** — on by default.

Place them with the existing Inbox feature settings. Extend the web/desktop Inbox
and shared environment behavior, including remote connections. Native mobile Inbox
UI remains deferred by the [parent Inbox spec](project-notification-inbox.md).
This change does not add importance scoring, a general bot filter, source writes,
or changes to OS/push notification preferences.

## Required behavior

- Both switches default to on for new and existing installations. Each switch is
  independent. A notification is hidden if it matches either category whose
  switch is off.
- Switching off immediately hides matching existing notifications. Switching on
  immediately reveals retained matching notifications that otherwise belong in
  the current view. Neither direction requires a manual refresh, source poll,
  another incoming message, reclassification job, or summary regeneration.
  Inbox lists, search, and displayed counts use the same visibility rules.
- Persist the global preferences through reloads and restarts, and propagate
  changes to other clients connected to the owning environment using existing
  settings synchronization. Reuse existing settings save/error behavior.
- Filtering changes visibility only. Preserve source content, summaries, read
  state, placement, and linked chats; hiding must not delete, settle, snooze, or
  disconnect anything. Revealing an item respects its existing placement and
  other current view filters.
- Continue source ingestion and AI summary generation for hidden notifications.
  Summary generation follows the existing enabled setting, model, prompt, retry,
  and failure behavior. Existing summaries are immediately reusable on reveal;
  toggling a filter must not restart summary work. An unfinished or failed
  summary retains the parent spec's delivery behavior.
- Recognize the user's own actions even when an integration relays them. For
  example, “Jakub Zak changed status to Done” posted by Linear Asks is an update
  caused by the connected user. The bot sender alone does not identify the actor.
- When the last reply is the connected user's, the second switch controls
  visibility whether that reply was sent through Blackbird, Slack, Linear, or
  another supported source application's normal interface. An already active
  notification disappears when this switch is off once the reply is ingested.
  Source actions remain subject to the existing intake cadence.
- A self reply must not reopen a settled notification, regardless of either
  switch. This preserves the parent spec's reply-state rule; hiding is separate
  from settlement.
- Evaluate current relevant activity in source chronology. A genuinely later
  reply from someone else makes the conversation eligible to appear again;
  historical self activity must not keep it hidden permanently. Replayed or
  out-of-order activity must not replace the actual last reply.
- Replies from Tars or another agent count as incoming replies from that agent,
  even when the user initiated its work. An automated sender is not by itself a
  reason to hide a notification. An ordinary incoming security sign-in alert
  remains included under both filters.

## Acceptance criteria

1. With default settings, existing and new notifications from both categories
   remain included. Turn either switch off with matching rows already displayed:
   those rows and their counts update immediately. Turn it on again: retained
   rows and completed summaries return immediately without a source refresh.
2. With **Show updates caused by me** off, an integration's notice that the user
   resolved an issue is hidden. The same kind of update caused by someone else
   remains eligible. Tars's incoming reply and a security sign-in alert remain
   visible when both switches are off.
3. With **Show conversations where the last reply is mine** off, reply in the
   source application to an active conversation. After normal ingestion, the
   existing item disappears without creating another item. A later reply from
   someone else brings the same item back under its normal placement rules,
   preserving context and its chat link. The same behavior holds for a reply
   sent through Blackbird.
4. Reply yourself to a settled conversation outside Blackbird: it stays settled
   with either switch on or off. Turning a filter back on does not move it into
   active intake. A genuinely later incoming reply follows the existing reopen
   behavior. Replaying older self replies does not hide that newer activity.
5. Hide a notification before its summary completes. Background generation still
   finishes under the existing summary rules; revealing it uses that result.
   Repeat with summary generation disabled or failed: filters neither enable it
   nor reset its retry budget.
6. Change a switch, reload, reconnect, and open another project or connected
   client: the saved global value applies consistently. With both switches off,
   enabling one leaves notifications matching the other disabled category hidden.

7. A reply accepted through Blackbird appears immediately in the notification,
   including an expanded Linear agent conversation and its linked chat details,
   without waiting for source intake or manually refetching. An older history
   response cannot replace the accepted reply. Repeated acceptance/source echoes
   do not duplicate the message, and failed sends do not create one. Existing
   visibility settings still apply as soon as the reply is accepted.

## Constraints and open questions

Use the existing settings, source identity, reply chronology, and Inbox service
contracts. Keep retained notification eligibility available without requiring a
source refetch when a switch changes. Preserve bounded list/detail responses;
instant toggling must not require downloading every full conversation.

Classification mechanism is an implementation choice; an additional AI model,
prompt editor, or user-defined category system has not been agreed. **Assumption
to validate during implementation:** retain visibility when the actor or last
reply cannot be determined reliably. No blocking product questions remain.

Compatibility: new settings default to on when absent, and activity kind metadata
is optional on retained records and wire payloads. No destructive data migration
is required. Older clients may lack the controls; upgrade the environment and
clients together for consistent immediate updates. Reverting the application
keeps retained content and placement; older versions ignore the added metadata.
