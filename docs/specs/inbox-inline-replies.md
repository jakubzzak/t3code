# Inline Inbox replies for Slack and Linear

## Problem and outcome

Inbox users can read a conversation and receive suggested actions but must leave Blackbird to reply. Let them open an inline composer for the focused notification, review or write a reply, and send it to the correct Slack thread or Linear issue conversation.

## Scope

Extend the existing web/desktop Inbox with text replies, Slack image attachments, and optional suggested reply drafts. This adds the narrowly scoped source writes excluded by the original [Inbox spec](project-notification-inbox.md); its other source-write exclusions remain. Native mobile Inbox remains deferred. The same server behavior must work for local and remote web/desktop clients.

No destination picker, unrelated channel posts or DMs, email replies, non-image attachments, Linear image uploads, issue edits, automatic sending, or automatic settlement. Reply-state ingestion and resurfacing are separate work; this feature must coexist with them without duplicating a sent response.

## Required behavior

### Open and review

- With an eligible Inbox item focused, plain **Enter** opens and focuses the reply input inside its relevant conversation. The shortcut must not intercept typing elsewhere.
- Add an icon-only reply action as the leftmost item in the CTA bar's right group, immediately before Snooze. Keep the agent buttons in the left group. Clicking it has the same behavior as Enter. Provide an accessible name and tooltip.
- When a suggested resolution includes an actual proposed message, show a non-clickable draft icon after the Suggestion heading, separated by a dot. Do not add visible “Draft available” text or make the status icon another action.
- Prefill the input with only the proposed message. Advice such as “check the deployment” is not a reply draft. Without a proposed message, open an empty input. A newer suggestion must not overwrite the user's edits.
- Place the input below the conversation in both Inbox and linked-chat Details. Opening Reply in Details expands its source conversation. Label the input section simply **Thread reply**. Opening or generating a draft never sends it. Use **Send** and **Cancel** for the reply, with image attachment and removal controls for Slack; Cancel discards the draft without sending or marking the item read. Do not add separate Check result, Ignore, or Close actions.

### Destination

- **Slack:** send to the notification's existing thread. If there is no thread, start one beneath the relevant message, including in DMs. Do not send a top-level DM or broadcast a thread reply to the channel.
- **Linear:** reply to the relevant comment when the notification has one. For an issue notification without a comment, such as assignment or status change, create a new comment on that issue.
- Preserve the source identifiers and reply relationship that determine the destination. Do not infer a target from rendered text or whichever comment is newest. New intake while composing must not silently redirect the draft.
- Notifications without a supported, resolvable destination cannot send; explain why without substituting another destination.

### Send and recover

- **Cmd+Enter** inside the composer sends the reviewed text. Use the application's platform modifier equivalent outside macOS. Plain Enter inside the input inserts a newline. Existing Cmd+Enter agent delegation remains unchanged when focus is on the notification row.
- Disable the input and send controls and show a pending state during the request. Repeated activation must not duplicate the send. Empty or whitespace-only replies cannot send unless they include an image. Slack accepts up to four PNG, JPEG, GIF, or WebP images of at most 10 MB each, selected, pasted, or dropped into the reply. Display incoming images in originals and replies, including image-only messages.
- After confirmed source success, display the returned response in the conversation, clear the sent draft and its indicator, and mark the Blackbird Inbox item read if needed. Do not settle it or claim the source application's read state changed.
- If posting succeeds but local refresh/read-state updates fail, retain the successful send result and recover those local updates without reposting. Later source ingestion must reconcile the response by source identity. If Slack confirms an image upload before its message metadata is available, keep a visible sent-image placeholder and reconcile it by file ID. Do not use the host clock as a source-activity cursor or clear newer concurrent incoming activity.
- A definite send failure preserves edited text, restores controls, and explains the next step. Missing posting permission leads to reconnection; rate limits expose the retry time. An uncertain delivery outcome must be distinguished from a definite failure and must not automatically resend. For a pending or uncertain attempt, Send checks the existing command ID without posting again; reopening restores that attempted message and command ID. Check the source conversation before canceling an uncertain attempt and composing another reply.

### Linked Linear chats

- Agent and Agent chat from a Linear issue notification associate the originating issue with the chat's standard linked-issue metadata. Retain an explicitly selected issue and the existing workspace when reopening the chat. Linear project notifications without an issue do not acquire a substitute issue.
- On a linked Linear control, clicking the issue label opens that issue in the desktop Linear right panel. Only the right chevron opens the issue picker. Use the same split action in the composer toolbar and Details, consistent with Finder and Actions. An unlinked control opens the picker from either part.

### Connections and shared behavior

Use the connected user's identity. Existing read-only connections continue reading and show when a posting upgrade is needed. Request additional authorization through the existing connection flow; record granted capabilities rather than treating “Connected” as proof of write access. Canceling an upgrade preserves reading and the draft.

Slack supports user-token posting with `chat:write` and thread replies with `thread_ts`. Request `im:write` as well for direct-message access; this grant does not change the composer destination or enable top-level DM sends. Existing connections need reconnection to receive the new grant. Image previews and uploads additionally require `files:read` and `files:write`; existing connections may need reconnection. Linear provides the targeted `comments:create` scope and the `user` actor. Retain existing read permissions and avoid requesting broad write/admin access for this feature. See the [Slack posting API](https://docs.slack.dev/reference/methods/chat.postMessage/) and [Linear OAuth documentation](https://linear.app/developers/oauth-2-0-authentication).

Posting belongs in a shared server service, with typed contracts and permission-guarded client commands. Any agent entry point must use the same destination and send rules and require explicit confirmation of the exact message; a suggested resolution or delegated task is not send approval. Never send test messages to real conversations without explicit authorization.

The current Slack transport only allows read methods, and Linear's displayed comments do not retain sufficient reply relationships. This requires implementation as well as additional permissions. Keep suggestions and message drafts distinct in the data consumed by the composer.

## Acceptance criteria

1. For a Slack notification with a suggested message, the status icon appears after the Suggestion dot. Enter and the right-group reply action open the same prefilled composer. Editing and sending produces exactly one reply in the correct thread, including a new thread under a DM message.
2. A general suggestion without a message opens an empty composer with no draft status icon. Updating the suggestion while composing leaves user edits intact.
3. Linear comment notifications reply to their relevant comment; issue notifications without comments create an issue comment. A newer incoming comment does not change the destination of an open draft.
4. Cmd+Enter delegates from the row and sends from the composer. Pending controls prevent duplicate sends. Confirmed success displays the response and marks only the Blackbird item read; settlement is unchanged.
5. Missing scope, cancellation, rate limiting, definite failure, and uncertain delivery retain recoverable drafts. A successful post followed by a local update failure never causes a second external message.
6. Local and remote web/desktop sessions enforce the same permissions and destinations. Existing Inbox browsing and agent actions remain usable on read-only connections.
7. A chat created from a Linear issue notification retains that issue after creation/reopening. The issue label opens Linear in the right panel; the chevron opens selection without opening or changing the linked issue.

## Non-blocking assumptions

- Escape closes the input while preserving edits; reopening or moving between notifications restores each draft during the session. This was proposed but not explicitly confirmed. Persistence across restarts or devices is not required by this spec.
- Successful sending or explicit Cancel removes the draft indicator and must not immediately reinsert the same consumed suggestion. No new draft-management screen is included.
