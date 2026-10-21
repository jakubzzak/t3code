# Project notification inbox

## Problem and outcome

Slack messages, Linear updates, and email have become separate task lists. Blackbird needs one quiet, Inbox Zero intake where the user can understand each item, act on it, or hand it to an agent. Notifications remain separate from chats, with an explicit, durable connection when work becomes a chat.

## Scope

Add an optional project notification inbox, source configuration, concise AI summaries, delegation, optional suggested resolutions, and memory of previous cases. All notification browsing happens in the left sidebar. Source access is read-only in this version: read, snooze, and resolution state belongs to Blackbird. Sending replies, archiving source messages, changing Linear issues, and synchronizing state back to sources are next steps, outside this scope. Suggestions and delegation do not grant additional source-write permissions.

### Project settings and sources

- Make **Settings → Features** project-aware using the existing settings scope and inheritance patterns. **Inbox** and the existing **Linear view** are independent feature switches, disabled by default. Move Linear view away from its current device-wide scope. Enabling Inbox must not enable Linear view, and using Linear as an inbox source must not require Linear view.
- Features contains feature-specific customization: summary model, delegation agent/model and default prompt, optional pre-resolution, and memory behavior. Every exposed feature setting must be configurable per project.
- **Settings → Integrations** contains connection setup and source-selection configuration for Slack, Linear, and Superhuman, including existing Linear integration configuration. Do not move connection setup into Features.
- All three integrations are optional and explicitly configured for each project. Reusing a stored connection in another project is allowed, but must be selected and configured there again; credentials need not be duplicated. Do not infer project ownership from account reuse or automatically enroll other projects.

| Source     | Configurable relevance selection                                     | Visible location        |
| ---------- | -------------------------------------------------------------------- | ----------------------- |
| Slack      | Multiselect: DMs, personal mentions, group mentions, saves, todos    | Channel or DM context   |
| Linear     | Full notification center, with configurable inclusion                | Issue ID                |
| Superhuman | Important by default, with configurable bucket/group/label selection | Bucket, group, or label |

These describe the intended source semantics, not verified connector capabilities. Missing source access must be visible; do not silently substitute an email provider's importance flag for Superhuman's classification.

## Required behavior

### Sidebar and notification contents

- Add top-level **Chats / Inbox** tabs within the left sidebar. Switching them preserves the current main-panel chat, draft, scroll position, and running agent. There is no middle-panel notification view.
- Reuse the existing Linear issue-view tab component and its sliding indicator, animation, and liquid-glass treatment. Reuse chat search, filters, row/menu conventions, and collapsed-section components wherever possible. Avoid a parallel sidebar design system.
- Show active notifications first. **Delegated**, **Snoozed**, and **Resolved** use the existing chat section appearance and expansion behavior; their contents are collapsed by default and discoverable through their headers and filters.
- Each notification has its source app logo, a one-sentence description of the relevant details, its source location, an original-content preview, and trailing action icons. Expanded details preserve the raw source content and show the separate AI summary as an attached comment. Summaries are one to five sentences, as short as possible.
- Group activity by source-native context where possible: a Slack thread, Linear issue, or email conversation. Preserve the exact triggering messages/comments and enough surrounding context to understand the request without another initial information-gathering step. Grouping must not discard individual notification details or invent cross-source identity.
- Clicking or arrow-focusing a notification expands it and smoothly collapses the previous item. Only one notification is open at a time. Focus controls expansion; ordinary Enter does not collapse the focused item.
- Raw content stays usable while AI processing is pending or unavailable. Summary failure must not hide the source item. Connection failures identify the affected source without blocking healthy sources or disguising stale content as current.

### Read status and lifecycle

Read/unread is independent of whether an item is active, delegated, snoozed, or resolved. A chat link is also preserved across snooze and resolution.

- Clicking or arrow-focusing marks the notification read. Its read-state action and context menu allow **Mark as unread**. Doing so while it remains focused must stick; the same focus must not immediately mark it read again. Leaving and focusing it again marks it read.
- Delegating moves the item out of active intake into **Delegated**, visibly associated with its chat.
- Snoozing hides the item until the chosen time. Unsnooze or expiry restores the appropriate active/delegated placement, retaining the chat link. Reuse existing snooze choices and controls.
- Resolving moves it to **Resolved**. A visible reopen action restores the appropriate active/delegated placement. Resolving does not delete source content, chat history, or the link.
- Settling the linked chat resolves its notification; reopening that chat restores the notification to Delegated. Notification resolution itself is not permission to erase a chat or its work.
- New activity in an already delegated source conversation retains the connection to its existing chat instead of creating a duplicate task. Whether that activity should start another agent turn is addressed under assumptions below.
- Persist notification state and links through restart and reconnect; connected clients must converge on the same project state.

### Two delegation actions

| Action                     | Icon                 | Behavior without a linked chat                                                                                                        |
| -------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Agent** — primary        | `bot`                | Create a linked chat and immediately start the configured agent using the project's editable default prompt and notification context. |
| **Agent chat** — secondary | `bot-message-square` | Create and open a linked chat with notification context, then wait for user input without starting an agent turn.                     |

Direct delegation can run while the user's current main-panel chat stays open. Agent chat intentionally opens the new chat. Both actions place the notification in Delegated once the link is established. If a chat is already linked, either action simply opens that same chat: no duplicate chat and no additional agent turn.

The notification shows a clear chat link. In the chat, the originating notification, source location, content preview, AI summary, and links back to the notification and original item appear in the existing **top-right Details bubble**. Do not add a competing notification panel in the main chat area.

Repeated activation, retries, or concurrent clients must not create duplicate chats or turns. A failed chat creation leaves the notification actionable. If creation succeeds but agent startup fails, preserve the linked chat and expose the failure and a recovery path; do not present it as successfully running.

### Keyboard interaction and undo

These shortcuts apply when the inbox list owns focus, not while typing in search, a composer, an editor, or a terminal. Reuse the application's platform modifier convention outside macOS.

| Shortcut        | Action                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| Up / Down       | Move notification focus; expand the new item and collapse the old one.  |
| Cmd+Enter       | Direct Agent delegation; open the existing chat when already linked.    |
| Cmd+Shift+Enter | Open Agent chat to compose; open the existing chat when already linked. |
| Cmd+Shift+H     | Snooze / unsnooze.                                                      |
| Cmd+Shift+U     | Toggle read / unread.                                                   |
| Cmd+E           | Resolve.                                                                |
| Cmd+Z           | Undo notification actions in order, including delegation.               |

Holding Command shows mild shortcut hints over the focused row's action icons without changing layout. Command-number chat jumps do not navigate notifications or unexpectedly switch chats while the inbox list owns focus. Existing shortcuts retain their behavior outside that focus scope, including composer bindings that overlap these keys. Merely opening an existing chat is navigation, not a new delegation to undo.

Undo restores Blackbird notification state; it must not promise to reverse already completed agent side effects or delete work. The precise behavior after an agent has started is a blocking question below. Marking an item unread through Undo must also survive the current focus.

### AI summaries, suggested resolutions, and memory

- Let the user select the summary model in project Features settings. Keep generated text distinguishable from source text. Changing the model must not rewrite raw notification content.
- Optional **pre-resolution** augments the summary with suggested next steps when the available context supports a useful answer. It may show a step-by-step process, suggested actions, or a drafted response. It neither executes the suggestion nor automatically resolves the notification.
- Processing and preprocessing look up similar previous messages/cases and their resolutions, using relevant outcomes to inform the current suggestion. Memory must cover the notification and its linked work, rather than only the summary text.
- Distinguish an observed resolution or response from an unconfirmed AI proposal. A resolved flag alone does not prove a successful answer. When no relevant precedent exists, suggestions must not imply there is one.

## Acceptance criteria

1. With Inbox off, the ordinary chat sidebar remains unchanged. Enable Inbox for project A and configure Slack; project B remains unconfigured even when it can reuse the same credentials. Enabling Inbox with Linear as a source does not turn on Linear view. Feature customizations and integration selections stay in their respective settings sections.
2. Switch Chats/Inbox while composing in an existing chat: the main panel and draft stay intact. Search and filter notifications with the reused controls. Delegated, Snoozed, and Resolved have the same collapsed-section behavior as chats.
3. Move through Slack, Linear, and email notifications with arrows. Each has the required logo, source location, description, and content. Only the focused item expands and becomes read. Mark it unread without moving focus; it remains unread until a later visit. Grouped comments retain their exact triggering context.
4. Direct delegation starts one agent with the project prompt; Agent chat starts no turn until the user submits. Repeated activation of either action opens the existing linked chat. Both sides expose the link, and the chat preview lives in its top-right Details bubble. Failed startup is visible and recoverable.
5. Snooze/unsnooze and resolve/reopen preserve read state and chat links. Settle and reopen the linked chat and observe the corresponding notification placement. Restart or reconnect a second client without losing these states or creating duplicate tasks.
6. Exercise every shortcut through keyboard focus and Command hints. No numbered chat jump fires from the inbox list, and overlapping composer/editor shortcuts still work elsewhere. Undo restores state, including an explicitly unread focused item; delegation rollback follows the confirmed policy below.
7. Select a summary model and enable pre-resolution. A matching historical case with a known outcome informs the suggestion; absent or unconfirmed history is not fabricated as evidence. Raw content remains usable when AI or one connector fails, and no summary, suggestion, snooze, or resolution writes to the source.

## Constraints and decisions

Reuse [LinearIssueViewTabs](../../apps/web/src/components/linear/LinearIssueViews.tsx), [chat section headers](../../apps/web/src/components/ui/collapsible-section-header.tsx), and existing settings scope/inheritance controls. The current [Features page](../../apps/web/src/routes/settings.features.tsx) stores Linear view as a device preference; changing its scope is part of this feature, not an already available capability.

Keep state and source access in environment services with typed contracts and permission checks, available to local and remote clients and normal agent entry points. Do not put durable lifecycle rules solely in sidebar handlers. Fetch bounded previews and details without sending every source history to every client. Respect reduced motion and avoid continuously repainting animations. The sidebar design applies to web/desktop; mobile must preserve shared state and scope semantics, with its presentation decision noted below. Existing desktop-only Linear view restrictions remain.

## Assumptions and open questions

- **Blocking before implementing delegation undo:** after direct delegation has started, should Cmd+Z restore the notification to active intake and request the agent to stop, retaining the linked chat and completed work, or restore intake while allowing the agent to continue? Cancellation cannot guarantee rollback of completed effects. A restored active item may retain its chat link so a later delegation opens it rather than duplicating work.
- **Connector feasibility prerequisite:** verify access to Slack saves/todos, Linear notifications, and actual Superhuman Important/bucket metadata. The discussion did not establish supported APIs or permissions. Report unavailable selections explicitly and resolve any required scope reduction before claiming the complete source behavior.
- **Proposed defaults, not separately approved:** later activity updates a delegated item's context without automatically starting another turn; overlapping source items in separately configured projects have independent state and memory; memory lookup does not cross project boundaries.
- **Migration decision:** existing device-level Linear view opt-ins need an explicit migration policy. Do not silently enable the feature or configure source integrations for every project. Preserve stored connection data.
- **Mobile presentation:** the discussion approved the left-sidebar web/desktop design but did not choose a native mobile inbox layout. Confirm native UI scope before claiming all-surface completion.
