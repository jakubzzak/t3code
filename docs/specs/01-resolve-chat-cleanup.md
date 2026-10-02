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
- Conversation and code changes survive resolution.
- Reopening the chat starts no tools or processes automatically.
- Resolving one chat does not affect another chat's resources.
- Remote resolution stops resources on the hosting environment.
- External browser tabs remain open.
