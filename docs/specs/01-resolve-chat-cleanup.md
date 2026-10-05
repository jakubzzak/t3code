# 01 — Resolve chat cleanup

**Status:** Implemented; native mobile UI verification pending.

## Goal

A resolved chat leaves no managed chat-owned tools or identifiable processes running, reducing memory
usage and preventing leftover terminal jobs.

## Behavior

Use the existing **Settle** action in the sidebar, thread menu, and keyboard actions.
Do not add a separate Resolve button to the chat header.

1. If the agent is working, ask for confirmation before stopping it. Cancel leaves
   the chat unchanged.
2. If the agent is idle, proceed without confirmation, even when terminal jobs are
   running.
3. Stop the agent, managed terminal commands, and identifiable descendants. Include
   background jobs outside visible terminals when retained ownership markers identify them.
4. Close all chat-owned right-bar tools, including the embedded browser.
5. Attempt graceful shutdown, then automatically force-stop remaining processes
   after a short grace period.
6. Mark the chat resolved only after cleanup succeeds.
7. If cleanup fails, keep the chat unresolved, show what remains running, and offer
   **Retry** and **Close**. Dismissing an error does not resolve the chat.

Verify process-monitor availability before interrupting the agent or locking new
work. If that check fails, leave the chat usable and show a dismissible error.
Development startup prepares the current native resource monitor before launching
the server, including desktop dev; web-only dev uses its connected server's monitor.
An explicit `T3CODE_RESOURCE_MONITOR_PATH` override is respected. Missing or outdated
monitors must never silently skip process verification or report cleanup success.

## Automatic settlement

Automatic settlement uses the same chat-owned cleanup as manual Settle. Existing
inactivity, merged/closed pull request, project override, and per-thread opt-out
rules decide eligibility. Working agents, queued turns, pending approvals or
questions, and live background work still prevent automatic settlement. Recheck
eligibility and intervening thread activity immediately before locking cleanup;
a stale decision must not interrupt resumed work.

Once eligible, stop all owned tools and identifiable processes, including running
terminal commands. Do not restrict automatic cleanup to idle terminals. Mark the
thread settled only after verified cleanup, preserving the timestamp that made
it eligible for the settled shelf. On failure, leave it unsettled; a later sweep
or manual Settle retries cleanup. Automatic cleanup does not open an unsolicited
modal. Manual Settle displays the current cleanup or retry result.

Web and desktop close the settled chat's tool panels when they observe settlement,
including after reconnecting or settlement from another client. Other chats and
environments remain unaffected. Opening a settled chat does not restart tools.

## Cleanup progress modal

- Once cleanup starts, show a simple, compact modal titled **Resolving chat**.
  Show it after any required active-agent confirmation; it adds no confirmation
  step when the agent is idle.
- List all processes and tools targeted for closure, including the agent,
  terminals, background jobs, and embedded browser tabs. Use readable names and
  enough detail to distinguish similar entries.
- Keep a status indicator beside each entry: a loading indicator while it is
  running or closing, then a checkmark once shutdown is confirmed. The indicator
  is not an action button. Keep completed entries visible until the modal closes.
- Drive status from actual cleanup results; do not show success based on elapsed
  time or a shutdown request alone.
- While cleanup is pending, the progress modal cannot be dismissed manually.
  The earlier active-agent confirmation remains cancelable before cleanup starts.
- If cleanup fails, keep the chat unresolved. Mark affected entries with a clear
  error and offer **Retry** for the remaining cleanup. Allow **Escape** or **Close**
  to dismiss the error; mobile also supports its system back action. Outside-click
  dismissal remains disabled. Stop loading indicators for failed entries.
- Dismissal does not cancel server cleanup or claim success. Settle can be used
  again to retry. Retain captured process identities across retries, and keep new
  resource launches blocked after partially completed cleanup until it succeeds.
- When every entry is confirmed closed and the chat is resolved, briefly show the
  completed state, then automatically dismiss the modal.
- Use subtle, short animations for modal entry, loading, the transition to a
  checkmark, and modal exit. Animate loading only while cleanup is pending; avoid
  unnecessary repainting. Respect reduced-motion preferences with static status
  indicators and immediate or minimal transitions.
- Keep keyboard focus within the modal, announce progress accessibly, and restore
  focus to the chat or the next appropriate destination after automatic dismissal.

## Preserved state

Keep conversation history and code changes. Returning to or reopening the chat
must not restart resources automatically; tools start fresh when needed.

## Ownership and remote use

Each chat owns its resources independently. Cleanup must target explicitly tracked
chat-owned resources and leave other chats unaffected. Ownership comes from captured
process handles, parent-child relationships, and inherited environment markers—not
process names, workspace paths, or ports. For remote connections,
processes must stop on the environment hosting them.

**Agreed ownership limit:** arbitrarily detached processes are not guaranteed to be
identifiable. macOS hides environment markers on protected system programs, and
commands may discard their inherited markers. Report this limit in the cleanup
modal and user guidance. Resolve succeeds after all identified resources are
confirmed closed; it must not claim that untracked detached jobs were stopped.
Stronger per-chat isolation is a future enhancement.

## Out of scope

- Automatic cleanup when archiving a chat.
- Automatic cleanup when an agent finishes a turn.
- Closing external browser tabs.
- Sharing processes between chats.

## Acceptance criteria

- Manual and automatic settlement use the same cleanup and ownership checks.
- A stale automatic decision never interrupts newly active or opted-out work.
- Automatic cleanup failures leave the chat unsettled and retryable.
- The chat header has no separate Resolve button; existing Settle actions remain.
- Successful settlement leaves no managed processes or identifiable descendants running, or chat right-bar tools open.
- Active-agent confirmation can be canceled without side effects.
- Idle-agent resolution needs no confirmation, including when terminal jobs are running.
- Stubborn processes are force-stopped automatically after a grace period.
- Failed cleanup is visible and retryable; the chat remains unresolved.
- Cleanup displays a modal listing every targeted process and tool, with loading
  indicators that become checkmarks only after confirmed shutdown.
- Pending cleanup cannot be dismissed manually. Failed cleanup offers Retry and
  can be dismissed with Escape, Close, or mobile back without resolving the chat.
- Missing process-monitor support is detected before cleanup interrupts or locks
  the chat; after repairing the monitor, Settle can be retried.
- Development startup builds the current monitor before starting a backend and
  surfaces build failures before launch; explicit monitor overrides and web-only
  startup do not require a local build.
- Successful cleanup shows the completed state and automatically dismisses the
  modal with a short exit animation.
- Modal and status transitions respect reduced-motion preferences and remain
  keyboard and screen-reader accessible.
- Conversation and code changes survive resolution.
- Reopening the chat starts no tools or processes automatically.
- Resolving one chat does not affect another chat's resources.
- Remote resolution stops resources on the hosting environment.
- External browser tabs remain open.
