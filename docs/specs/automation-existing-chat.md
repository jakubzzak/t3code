# Run automations in an existing chat

## Problem and outcome

Users can bind an automation to a chat through agent tools, but cannot choose that
destination in the automation editor. Expose this choice alongside the existing
workspace options so recurring work can continue in one conversation. Before a
user archives that conversation, explain that its automations will be paused.

## Scope

Support automation creation and editing on web, desktop, and mobile, including
editors reached from chat details or Settings. Keep the existing scheduler,
chat-binding model, and checkout choices. Apply archive behavior consistently
across entry points, including keyboard and bulk actions where available, and
across local, remote, relay, and tunnel connections.

This does not introduce a separate results inbox, a new scheduler, or changes to
prompt, schedule, model, or provider selection semantics.

## Required behavior

### Choose a chat

- Add **Use an existing chat** to the **Workspace** choices alongside **Create a
  new worktree**, **Use the project checkout**, and **Use a specific checkout**.
- Selecting it reveals a searchable chat picker scoped to the automation's
  selected project and environment. Include running, idle, and resolved/settled
  chats. Exclude archived chats. Show chat titles with branch or checkout context
  when available, ordered by recent activity.
- Explain: **Each run continues this chat, using its conversation history and
  checkout.** Hide independent checkout controls while this option is selected.
  Selecting a chat does not move it to another checkout.
- Require an eligible chat before saving. Empty results and loading failures
  must not silently select a different destination. Changing the project or
  environment clears an incompatible selection. Revalidate eligibility on save
  so a chat archived elsewhere cannot become a new destination.
- Editing a bound automation shows its current binding, including bindings made
  through agent tools. An archived destination remains identifiable on an existing
  paused automation even though it is excluded from new selections.
- Saving a binding updates the existing automation without duplicating it or
  changing its prompt and schedule. Choosing another chat rebinds it; choosing a
  checkout option removes the binding and restores fresh-chat-per-run behavior.
- Runs continue in the selected chat through the existing queued delivery path;
  a scheduled prompt must not interrupt a running agent. Resolving or settling a
  chat does not pause its automation and does not show an automation confirmation.

### Archive a bound chat

Before archiving a chat used by an automation, show this confirmation:

**Archive chat and pause automation?**

> This chat is used by “Jurata: Daily brief”. Archiving this chat will pause the
> automation. You can reconfigure it in **Settings → Automated tasks**.

Actions: **Cancel** and **Archive and pause**. Substitute the actual automation
name. For multiple attached automations, list their names and use plural wording
that clearly states they will all be paused.

- Cancel leaves the chat and automations unchanged.
- Confirm archives the chat and pauses all attached enabled automations. Already
  paused automations remain paused. Preserve their bindings, prompts, schedules,
  and records so they can be reconfigured in Settings.
- Chats without attached automations retain their existing archive flow. Bulk
  archive must disclose the affected automations before applying the same rule.
- Persist pausing in the environment; closing the client must not defeat it.
  Archive must not report successful completion while affected automations remain
  enabled. Surface failures and reconcile persisted state after reconnecting.
- Pausing prevents future scheduled work; it does not imply cancellation of an
  agent turn already running. Existing archive lifecycle guards still apply.

## Acceptance criteria

1. Create an automation and choose a running, idle, or resolved chat in its
   project. Archived chats and chats in another project/environment are absent.
   Repeated runs reach the selected chat without creating new conversations;
   delivery to a running chat queues without interrupting it.
2. Edit an automation previously bound by an agent. Its destination is visible;
   rebind it or switch to a checkout option. Its identity, prompt, and schedule
   remain unchanged, and subsequent runs use the newly selected destination.
3. Resolve or settle a bound chat. No automation confirmation appears and its
   automation remains enabled. A later scheduled run can continue that chat
   through the normal chat lifecycle.
4. Archive a chat with one or several automations. Verify the names, pause warning,
   settings guidance, and action labels. Cancel changes nothing; confirm archives
   the chat and durably pauses all its enabled automations. Verify equivalent
   behavior through other archive entry points and on another connected client.
5. Archive the selected chat from another client before saving a new binding.
   Saving rejects the stale destination with a recoverable error. A failed archive
   or interrupted connection must not show a successful archive with an enabled
   attached automation.

## Constraints and decisions

Reuse the existing nullable scheduled-task `threadId`, agent binding tools, and
queued delivery service. Keep archive/pause consistency in environment services,
not solely in client handlers, and preserve existing permission checks. Use chat
summary data for the picker rather than fetching conversation histories. Verify
resolved-chat delivery against existing settlement and checkout recovery rules;
selectability must not promise a destination the scheduler cannot use.

## Assumptions and open questions

- Nonblocking assumption: unarchiving does not automatically resume automations;
  the user resumes or reconfigures them explicitly in Settings. This recovery
  default was proposed but not explicitly accepted in the discussion.
- The current settings page is labeled **Scheduled tasks**, while the requested
  modal copy says **Automated tasks**. Align the settings reference with the actual
  destination during implementation review so the guidance is discoverable.

No blocking product questions remain for implementation review.
