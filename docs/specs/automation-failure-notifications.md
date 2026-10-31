# Make automation failures visible

## Problem and outcome

An automation can fail before its agent starts when its selected provider is
disabled. Today the failure can remain unnoticed in automation settings, where
an internal exception and stack trace give little help. Record the failure in a
chat and proactively notify the user, with a clear explanation and recovery steps.

## Scope

Cover scheduler dispatch failures, including globally and project-disabled
providers, for scheduled triggers and **Run now**, with existing-chat and new-chat
destinations. Web and desktop show the actionable in-app notification; all clients
can read the durable failure in the chat. Preserve existing mobile push and OS/sound
preferences. Agent failures after successful dispatch retain their existing flow.

## Required behavior

- Reopen the automation's existing chat when available, clearing archived,
  settled, or snoozed state. Create a chat if the automation normally starts a new
  one or the destination is unavailable. If its destination has active work,
  record the failure separately without interrupting that work.
- Save the attempted automation prompt and an **Automation failed** error in the
  chat. A rejected attempt must not start a provider or prepare a worktree merely
  to show the error. Preserve task identity and message provenance.
- When a provider is disabled, name its configured display name and explain how
  to enable it in provider settings or choose an enabled provider for the
  automation, then retry with **Run now**. Other dispatch errors show a readable
  cause and recovery guidance. User-facing error text must not contain a stack
  trace or substitute an internal provider ID for an available display name.
- Show a persistent **Automation failed** in-app notification with **Open thread**.
  Reopening or creating the chat does not change the user's current view. Clicking
  the notification opens the correct chat in the owning environment.
- Treat these failures as actionable errors even when routine in-app notifications
  are off. Do not enable OS notifications or sounds. Unread failures are discoverable
  when the client connects or returns to the foreground; reconnecting must not
  repeatedly notify about a failure already read or resolved.
- Reading the chat or resolving, settling, archiving, or snoozing it clears its
  outstanding notification. A later failed attempt can notify again.
- Keep scheduler failure bookkeeping and its next occurrence. Enabling a provider
  does not automatically retry a failed occurrence; **Run now** explicitly retries.

## Acceptance criteria

1. Disable the automation's provider globally or for its project, then trigger
   either destination mode. The task records a failure, a chat contains the prompt
   and actionable error, and no provider turn starts.
2. Fail an automation bound to an archived or settled chat: it reopens. Fail one
   bound to a busy chat: existing work continues and a separate failure chat appears.
3. With routine notifications off and another chat open, trigger a failure. A
   persistent notification appears without navigation; **Open thread** opens its
   failure. The provider display name and recovery instructions are readable in
   both automation settings and chat.
4. Reconnect or return after an unread failure: it remains discoverable. Read the
   failure and reconnect: it does not notify again. A subsequent failed attempt
   is independently visible. Ordinary historical failures are not replayed.
5. Enable the provider and explicitly retry: normal dispatch resumes while the
   failed attempt stays in history. Generic dispatch failures also receive a
   durable, readable failure chat.

## Constraints and decisions

Use the environment-owned scheduler and existing orchestration, projections, and
notification paths. Provider availability is provider-agnostic; no adapter-specific
fallback or automatic provider switch is introduced. Persist sufficient failure
metadata for remote clients and reconnects without requiring a database migration.
Older threads without that metadata retain their existing notification behavior.

Tracking: intentionally no Linear issue, as requested on 2026-10-31. No blocking
product questions remain.
