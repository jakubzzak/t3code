# Linear issues for chats

## Problem and outcome

Desktop users should be able to choose a Linear issue and continue work in its branch and worktree without manually coordinating Linear, Git, and T3 Code. Issue association stays optional and remains easy to add or change after a chat starts. Linked chats remain available on every client.

## Scope

Add a project-aware issue picker, durable chat association, branch/worktree setup and reuse, and issue creation through the existing Linear panel. Improve the Linear integration settings using the same components, spacing, and typography as other settings sections.

The new Linear controls are desktop-only and require both the feature setting and a configured Linear integration for the selected project. Desktop connections to local, remote, relay, and tunnel environments remain supported. In branch discovery, “remote” means GitHub; selecting an issue does not move the chat to another T3 environment. Web and mobile retain access to linked chats without gaining the desktop Linear controls.

This extends the [embedded Linear view](linear-view.md) with issue queries and explicit chat associations. Rebuilding Linear's issue editor, general-purpose Linear agent tools, and migrating existing worktree directories are outside scope.

## Required behavior

### Choose an issue

- Place the Linear issue selector beside checkout/worktree and branch controls in a new chat. Keep it readily accessible in existing chats for linking and switching issues. Never require an issue before sending a message.
- Initially show all issues assigned to the connected Linear user, with pagination as needed. Search covers accessible issues across the project's configured Linear workspace, including issues assigned to other people. Keep **Create issue** pinned at the bottom of the picker.
- Selecting an issue initiates setup directly in the chat. There is no generic confirmation or link-only/setup decision inside the picker. Show setup progress and failures in the chat.
- Persist the association with the thread rather than deriving it only from the branch name. Preserve it across reconnects, client changes, and feature disable/re-enable. Disabling the feature must not hide or delete chats.
- Provide a way to unlink the issue without deleting the chat, branch, or worktree. Linking and replacement preserve the current conversation history unless the user explicitly chooses to open another chat.

### Resolve the branch and worktree

- Use exactly Linear's suggested Git branch name. Do not prepend a T3 prefix, generate a substitute from the title, or append a branch suffix. If the suggested name cannot be obtained or used, report the problem instead of inventing a different branch name.
- Reuse a worktree for that branch in the selected project's repository when available. Otherwise create a worktree from the existing local branch, or fetch its GitHub branch and create a local tracking branch and worktree. If neither branch exists, create the branch and worktree from the selected base branch using the existing base-selection controls.
- Create new worktrees under `<T3 home>/worktrees/{project}/{branch-name}` on the owning environment. `{project}` identifies the original project even when starting from another worktree. Filesystem-safe representation must not change the Git branch name. Reuse existing worktrees in their current locations.
- Do not silently choose an unrelated repository, overwrite a conflicting directory, or reset existing branch contents. An ambiguous or unavailable target requires a visible resolution, not an arbitrary fallback.

### Existing chats on the target worktree

- If the previous chat is settled, reuse the worktree and link the current chat without a prompt. Preserve the settled chat's history.
- If the previous chat is unsettled, show a modal with **Open existing chat** and **Use this chat**, plus cancellation. Use T3's existing explicit settled state; an idle agent alone does not mean a settled chat.
- **Open existing chat** navigates to that chat without settling it. **Use this chat** links the current chat to the target issue, branch, and worktree, and settles the previous chat. Settlement must preserve the worktree being reused. Cancellation leaves both chats unchanged.
- A failed setup must not leave the previous chat settled while the current chat cannot use the target worktree. Preserve the previous working context on failure and make retry possible without creating duplicate worktrees.

### Create and replace issues

- **Create issue** reuses the chat's existing Linear tab in the right panel, or opens it if absent, and initiates Linear's issue-creation flow. Preserve the originating chat and any draft while the user works in the panel.
- When creation initiated from this action succeeds and the originating chat has no issue, associate the new issue automatically and run the same branch/worktree setup as picker selection.
- If the chat already has an issue, ask whether to switch to the newly created issue. Acceptance replaces the association and creates or reuses the new issue's branch and worktree for this same chat. Apply the existing-chat conflict rules if necessary. Declining preserves the current association and working context; the created Linear issue remains available.
- Canceling creation does not change the chat. Do not infer successful creation merely from opening the panel or navigating to an unrelated issue.

## Acceptance criteria

1. A configured desktop project with the feature enabled offers the picker before and after the first message. Assigned issues load initially, search finds an issue assigned to someone else, and the create action remains visible while scrolling. A chat can proceed without an issue.
2. Select issues whose suggested branches have an existing worktree, only a local branch, only a GitHub branch, and no branch. Each resolves to the appropriate working context without picker confirmation, retains Linear's exact Git branch name, and creates directories under the owning environment's T3 home when needed.
3. Reusing a settled chat's worktree preserves that chat and links the current one directly. For an unsettled chat, each modal choice has the specified effect; **Use this chat** settles the previous chat and preserves the shared worktree. Cancel and failed setup do not prematurely settle it.
4. Create an issue from an unlinked chat, then from a linked chat. The first associates and sets up automatically. The second asks to switch; accepting moves the same conversation to the new issue's working context, while declining leaves its existing context intact.
5. Open the linked chat from web and mobile and reconnect from another client. Its history and working context remain available. Feature disable/re-enable and unlinking preserve chat history and files. A disconnected Linear account or failed Git setup produces a recoverable error without falsely reporting success.
6. Linear settings use established settings styling, and configuring one project does not change another project's Linear workspace or account selection.

## Constraints and decisions

- The existing workspace slug and browser login-email override do not establish API authentication. Assigned-issue lookup, search, and suggested branch names need authenticated Linear API access; do not scrape the embedded website for routine queries.
- Reuse the existing Linear surface and settings conventions. Linear documents [URLs that initiate issue creation](https://linear.app/developers/create-issues-using-linear-new); they do not by themselves establish a completion callback. Explicit creation navigation must work with the existing surface's origin and workspace restrictions.
- Keep association and setup operations in environment services with typed contracts so clients observe consistent thread state. Provider sessions must execute subsequent work in the selected worktree, not retain a stale working directory.
- Existing dirty files must remain intact when changing worktrees. Switching or settling a chat does not authorize deleting its worktree, discarding changes, or moving uncommitted files to another branch.

## Open questions

The following block implementation of their respective flows, but do not block publishing this agreed product scope:

- **API connection:** Choose the authentication and credential ownership model, including how the connected account supplies “assigned to me” when desktop clients use remote environments. Browser login is not an API credential.
- **Creation completion:** Verify a reliable way to identify the issue created through the embedded panel and correlate it with the originating chat. Any fallback requiring manual selection would change the agreed automatic association and needs a product decision.
- **Active sessions and settlement:** Decide how switching and takeover behave when either chat has an active turn, pending input, or a provider session tied to the old directory. The existing settlement path guards against running sessions; do not bypass that protection or silently terminate work.

Non-blocking details to resolve during implementation: collision-safe project/directory naming without changing the Git branch name; multiple unsettled chats or ambiguous remote refs for one branch; and the display of linked issue metadata on web/mobile beyond the required chat visibility.
