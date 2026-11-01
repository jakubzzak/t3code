# Move chat to project

## Problem and outcome

A chat started in the wrong project should be able to continue in another project's directory without losing its conversation. The project name in the chat header currently starts a new chat. Replace that action with project selection and expose the same move through Command-K.

## Scope

Move an existing chat between registered projects in its current server environment, including chats attached to worktrees. Preserve the chat's identity, history, queued messages, and bound scheduled tasks. A remote client may initiate the same operation on that server; transferring a chat between servers and moving project runner services are out of scope.

The requested entry points are the shared web/desktop header and command palette. Native-mobile picker design is not specified; connected clients must still reflect the moved chat correctly.

## Required behavior

### Project selection

- Clicking the header's project name opens a simple menu matching the existing chat-title action menu: native on desktop, with the existing browser fallback. List the other available projects on the same server using their names and icons. Exclude the current project; do not add search to this menu.
- Command-K offers **Move chat to project…**, with the Lucide **FolderInput** icon, standard command-row styling, and a trailing submenu chevron. It opens a **Projects** submenu with the same destinations. Existing palette search filters destination names and folder paths.
- Include the complete visible action label and these aliases in command search terms: `move chat`, `move thread`, `change project`, `switch project`, `move conversation`, `workspace`, `directory`, `repository`, `repo`, and `handoff`.
- Dismissing either picker changes nothing. Selecting a destination immediately requests the move without a confirmation modal. If no other project is available, show an empty/disabled state rather than offering the current project.

### Handoff and continuation

- Queue a single handoff. If a turn is running, interrupt it and release the old provider session through the existing lifecycle. Do not start destination work while the old turn remains active. An idle chat follows the same move path without an interruption step.
- Resolve the destination's effective defaults through the existing project configuration and workspace setup flow. A worktree default creates a new worktree in the destination repository, honoring the existing base/origin and setup settings. A local default uses the destination project's current checkout. Do not retain the source repository's working directory or introduce separate move-specific setup settings.
- Allow moving out of an existing worktree. Leave the source checkout/worktree, branch, files, and completed edits untouched; do not copy changes, delete the worktree, or transplant it into the destination repository.
- Keep the same chat open and update its header and project grouping. Preserve conversation history. Future agent work uses the destination directory and its instructions; historical changes and checkpoints must not become restore operations against an unrelated repository.
- Once the destination is ready, automatically start exactly one continuation, including when the chat was idle. Tell the agent that its project/directory changed and to follow the destination's instructions. Resume unfinished work, or briefly acknowledge the switch if nothing remains. No additional user message is required.
- Preserve queued user messages and their order. Prevent them and scheduled runs from starting during the handoff. Repeated selection, reconnection, or retries must not duplicate the move, worktree creation, or continuation.
- The same action can move the chat back later, applying that destination's defaults again. This does not undo file edits or restore the previous worktree automatically.

### Scheduled tasks and failures

- Adopt Joel's behavior for tasks bound to the chat: update their project association with the chat while retaining their prompts, schedules, enabled state, and binding. Future executions use the destination project/workspace. Unbound tasks remain unchanged.
- Make in-progress and failed moves visible. Validate destination availability and permissions on the server. If preparation fails before the move is committed, retain the source association and report the failure; do not silently resume in the wrong directory.
- If the move succeeds but continuation fails, keep the chat in the destination, report that continuation failed, and allow ordinary retry or a new message there. Reconnecting must show the actual durable outcome rather than repeating the move.

## Acceptance criteria

1. From the header, select another same-server project without search or confirmation. From Command-K, find **Move chat to project…** using its label and aliases, then find a destination by name/path. Both paths exclude the current project and produce the same result.
2. Move a running chat with queued user input. The source turn stops, destination setup completes, and one automatic continuation runs in the new directory with history intact. Queued input is preserved and is not delivered during the transition.
3. Move an idle chat with no unfinished task. It moves and produces a brief acknowledgement automatically, without requiring another user message.
4. Move a chat already in a worktree to a project defaulting to a new worktree, then to one defaulting to local. The first destination uses its normal worktree/setup flow; the second uses its current checkout. Source worktrees and uncommitted edits remain untouched. Moving back is available.
5. Move a chat with a bound recurring task, including a task becoming due during the handoff. Its schedule and prompt are retained, no execution starts halfway through the move, and its subsequent run uses the destination. An unbound task is unaffected.
6. Exercise unavailable destinations, setup failure, continuation failure, duplicate requests, and a connection loss. Show the actual source/destination association and a useful failure state, without duplicate worktrees, runs, or lost messages. Verify the moved state from another connected client.

## Constraints and decisions

Adapt Joel's existing [directory handoff and continuation service](https://github.com/joelwohlhauser/blackbird/blob/f70bb7c8fa016a0e082399c3d62164ae05c40375/apps/server/src/mcp/WorktreeMcpService.ts#L421) and [bound-task project reassignment](https://github.com/joelwohlhauser/blackbird/blob/f70bb7c8fa016a0e082399c3d62164ae05c40375/apps/server/src/orchestration-v2/ProjectionStore.ts#L1955), rather than building a parallel workspace lifecycle. These references were inspected as source; Joel's installed build was not tested.

Reuse existing project defaults, setup, provider handoff, menu, and command-palette conventions. Keep the operation in a shared server service reachable through normal client commands and the agent handoff path. Preserve destination permissions and multi-client consistency. Verify behavior for each supported provider; an unsupported handoff must be explicit rather than silently continuing in the source workspace.

No blocking product questions remain. The native-mobile entry-point scope above is an explicit assumption; adding a separate mobile picker is not required by this agreement.
