# 01 — Resolve chat cleanup

**Status:** Agreed; not implemented.

## Goal

A resolved chat leaves no chat-owned tools or processes running, reducing memory
usage and preventing leftover terminal jobs.

## Behavior

Add a **Resolve** action at the top of the chat.

1. If the agent is working, ask for confirmation before stopping it. Cancel leaves
   the chat unchanged.
2. If the agent is idle, proceed without confirmation, even when terminal jobs are
   running.
3. Stop the agent and all chat-owned processes, including terminal commands,
   servers, and detached background jobs launched outside visible terminals.
4. Close all chat-owned right-bar tools, including the embedded browser.
5. Attempt graceful shutdown, then automatically force-stop remaining processes
   after a short grace period.
6. Mark the chat resolved only after cleanup succeeds.
7. If cleanup fails, keep the chat unresolved, show what remains running, and offer
   **Retry**.

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
- The progress modal cannot be dismissed manually: no close or cancel button,
  outside-click dismissal, Escape dismissal, or mobile back dismissal. The earlier
  active-agent confirmation remains cancelable before cleanup starts.
- If cleanup fails, keep the modal open and the chat unresolved. Mark affected
  entries with a clear error and offer **Retry** for the remaining cleanup. Stop
  loading indicators for failed entries.
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
chat-owned resources and leave other chats unaffected. For remote connections,
processes must stop on the environment hosting them.

## Out of scope

- Automatic cleanup when archiving a chat.
- Automatic cleanup when an agent finishes a turn.
- Closing external browser tabs.
- Sharing processes between chats.

## Acceptance criteria

- Successful Resolve leaves no chat-owned processes running or right-bar tools open.
- Active-agent confirmation can be canceled without side effects.
- Idle-agent resolution needs no confirmation, including when terminal jobs are running.
- Stubborn processes are force-stopped automatically after a grace period.
- Failed cleanup is visible and retryable; the chat remains unresolved.
- Cleanup displays a modal listing every targeted process and tool, with loading
  indicators that become checkmarks only after confirmed shutdown.
- The progress modal cannot be dismissed manually and remains open on failure
  with errors and Retry available.
- Successful cleanup shows the completed state and automatically dismisses the
  modal with a short exit animation.
- Modal and status transitions respect reduced-motion preferences and remain
  keyboard and screen-reader accessible.
- Conversation and code changes survive resolution.
- Reopening the chat starts no tools or processes automatically.
- Resolving one chat does not affect another chat's resources.
- Remote resolution stops resources on the hosting environment.
- External browser tabs remain open.
