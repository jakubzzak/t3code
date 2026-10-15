# Linear issues for chats

## Problem and outcome

Desktop users should be able to choose a Linear issue and continue work in its branch and worktree without manually coordinating Linear, Git, and T3 Code. Issue association stays optional and remains easy to add or change after a chat starts. Linked chats remain available on every client.

## Scope

Add a project-aware issue picker, durable chat association, branch/worktree setup and reuse, and issue creation through the existing Linear panel. Improve the Linear integration settings using the same components, spacing, and typography as other settings sections.

The new Linear controls are desktop-only and require both the feature setting and a configured Linear integration for the selected project. Desktop connections to local, remote, relay, and tunnel environments remain supported. In branch discovery, “remote” means GitHub; selecting an issue does not move the chat to another T3 environment. Web and mobile retain access to linked chats without gaining the desktop Linear controls.

This extends the [embedded Linear view](linear-view.md) with issue queries and explicit chat associations. Rebuilding Linear's issue editor, general-purpose Linear agent tools, and migrating existing worktree directories are outside scope.

## Delivery in two PRs

1. **OAuth and existing issues:** Deliver connection management, assigned issues and search, persistent associations, exact Linear branch naming, worktree setup/reuse, existing-chat conflict handling and settlement, running-agent guards, cross-client chat compatibility, and settings styling. This PR is usable independently. Do not expose the picker’s **Create issue** action until PR 2 delivers its complete flow. OAuth application registration and callback configuration are prerequisites for end-to-end verification.
2. **Issue creation:** Add the sticky **Create issue** action, opening the existing Linear panel's creation flow, reliable identification of the created issue, and automatic association or replacement confirmation. Reuse PR 1's setup and running-agent guards. This PR depends on PR 1; creation-completion detection must be resolved and verified before it is ready.

PR 1 covers acceptance criteria 1–3 and 5–8 for existing-issue flows, excluding the create action, creation completion, and creation-related races. PR 2 covers criterion 4 and those deferred creation-specific portions of criteria 1 and 8. The following requirements describe the combined result; the split does not remove them.

Tracking exception: the maintainer explicitly chose to proceed without a Linear issue. Continue on the existing dedicated spec/task branch.

## Required behavior

### Connect Linear

- Use OAuth through **Connect Linear** in Settings → Integrations → Linear. Users authorize their own Linear account; no personal API key entry is required or offered in this flow.
- Request read access for issue lookup, search, and suggested branch names. Issue creation continues through the authenticated Linear panel. OAuth authorization does not establish a browser login; preserve the panel's separate sign-in flow.
- After authorization, show the connected account and workspace, use that account’s email for panel login assistance without a separate email field, and validate that the connection matches the selected project's workspace. “Assigned to me” refers to the authorizing Linear user. Canceling or failing authorization must not replace an existing working connection.
- Refresh expired access automatically when possible. Provide reconnect and disconnect actions. Disconnect removes the stored authorization and attempts revocation, reporting if revocation could not be completed; it preserves chats, issue associations, and worktrees.
- Keep access and refresh tokens in protected credential storage, separate from ordinary project settings. Do not include credentials in synced thread data, logs, or agent prompts. Persisted desktop credentials require OS-backed encryption; do not silently fall back to plaintext.

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

### Running agents

- Disable actions that switch the current chat's issue/branch/worktree or take over another chat's worktree while an agent in either affected chat is starting or running. Show a message identifying the reason, such as **Wait for the agent in this chat to finish before switching issues** or **An agent is running in the existing chat. Wait before using its worktree**. Opening the existing chat for viewing remains available.
- Re-enable the action when the affected agents are idle. Do not stop agents or queue a switch automatically. Apply the same guard to setup after issue creation; if an agent starts while creation is open, preserve the created issue and offer setup again once idle.
- Recheck agent state when applying the change so an agent starting after the picker or modal opens cannot bypass the guard. A rejected action preserves the current association and working context and does not settle another chat.

### Create and replace issues

- **Create issue** reuses the chat's existing Linear tab in the right panel, or opens it if absent, and initiates Linear's issue-creation flow. Preserve the originating chat and any draft while the user works in the panel.
- When creation initiated from this action succeeds and the originating chat has no issue, associate the new issue automatically and run the same branch/worktree setup as picker selection, subject to the running-agent guard.
- If the chat already has an issue, ask whether to switch to the newly created issue. Acceptance replaces the association and creates or reuses the new issue's branch and worktree for this same chat. Apply the existing-chat conflict rules if necessary. Declining preserves the current association and working context; the created Linear issue remains available.
- Canceling creation does not change the chat. Do not infer successful creation merely from opening the panel or navigating to an unrelated issue.

## Acceptance criteria

1. A configured desktop project with the feature enabled offers the picker before and after the first message. Assigned issues load initially, search finds an issue assigned to someone else, and the create action remains visible while scrolling. A chat can proceed without an issue.
2. Select issues whose suggested branches have an existing worktree, only a local branch, only a GitHub branch, and no branch. Each resolves to the appropriate working context without picker confirmation, retains Linear's exact Git branch name, and creates directories under the owning environment's T3 home when needed.
3. Reusing a settled chat's worktree preserves that chat and links the current one directly. For an unsettled chat, each modal choice has the specified effect; **Use this chat** settles the previous chat and preserves the shared worktree. Cancel and failed setup do not prematurely settle it.
4. Create an issue from an unlinked chat, then from a linked chat. The first associates and sets up automatically. The second asks to switch; accepting moves the same conversation to the new issue's working context, while declining leaves its existing context intact.
5. Open the linked chat from web and mobile and reconnect from another client. Its history and working context remain available. Feature disable/re-enable and unlinking preserve chat history and files. A disconnected Linear account or failed Git setup produces a recoverable error without falsely reporting success.
6. Linear settings use established settings styling, and configuring one project does not change another project's Linear workspace or account selection.
7. **Connect Linear** completes OAuth without asking for an API key, identifies the authorizing account, and enables its assigned-issue list for the configured workspace. Cancellation preserves any existing connection. Expiry refreshes transparently or offers reconnect; disconnect preserves existing chats and issue associations. API authorization does not falsely mark the embedded panel as signed in.
8. With an agent running in the current chat or the target worktree's chat, switching/takeover is disabled with an explanatory message. When agents become idle, the action becomes available without executing automatically. Starting an agent after opening the picker, modal, or issue-creation flow cannot cause a workspace switch or premature settlement.

## Constraints and decisions

- The existing workspace slug and the panel’s browser login do not establish API authentication. Assigned-issue lookup, search, and suggested branch names need authenticated Linear API access; do not scrape the embedded website for routine queries.
- Use Linear's [OAuth authorization-code flow with PKCE](https://linear.app/developers/oauth-2-0-authentication), an S256 challenge, and validated state. Act as the authorizing user. A distributed desktop build must not embed a confidential client secret. Register the OAuth application and supported callback URLs before end-to-end connection verification.
- Reuse the existing Linear surface and settings conventions. Linear documents [URLs that initiate issue creation](https://linear.app/developers/create-issues-using-linear-new); they do not by themselves establish a completion callback. Explicit creation navigation must work with the existing surface's origin and workspace restrictions.
- Keep association and setup operations in environment services with typed contracts so clients observe consistent thread state. Provider sessions must execute subsequent work in the selected worktree, not retain a stale working directory.
- Preserve existing settlement and provider-session lifecycle guards, including pending-input handling. An idle session tied to the old directory must be rebound or recreated through the supported provider lifecycle before subsequent work starts.
- Existing dirty files must remain intact when changing worktrees. Switching or settling a chat does not authorize deleting its worktree, discarding changes, or moving uncommitted files to another branch.

## Compatibility and recovery

The association is an optional field on existing metadata events and a nullable additive projection column. Existing chats require no backfill. Deploy the server before the desktop client; the desktop exposes issue setup only when the connected server advertises support. Older desktop, web, and mobile clients retain ordinary chat access and ignore the new optional metadata. New clients connected to older servers leave issue controls unavailable.

Disable the feature to recover from a client integration problem; this preserves associations, conversation history, and worktrees. Prefer a forward fix for server projection problems. Reverting application code does not remove the additive database column; retain it. Before a binary downgrade, back up the environment database and verify that version can read its migration history. No down migration, file deletion, or branch reset is part of this feature.

## Open questions

The following blocks PR 2's automatic association after creation, but does not block PR 1 or publishing this agreed product scope:

- **Creation completion:** Verify a reliable way to identify the issue created through the embedded panel and correlate it with the originating chat. Any fallback requiring manual selection would change the agreed automatic association and needs a product decision.

Non-blocking details to resolve during implementation: collision-safe project/directory naming without changing the Git branch name; multiple unsettled chats or ambiguous remote refs for one branch; and the display of linked issue metadata on web/mobile beyond the required chat visibility.

OAuth implementation default, not a separately confirmed product decision: keep the personal connection and API requests on the desktop, with project bindings keyed by environment and project. Remote environments receive the issue association and Git setup request without receiving OAuth tokens. The registered application/client ID, callback route, and development/fork configuration still need to be established before end-to-end verification.
