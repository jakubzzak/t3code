# Linear issues for chats

## Problem and outcome

Desktop users should be able to choose a Linear issue and continue work in its branch and worktree without manually coordinating Linear, Git, and T3 Code. Issue association stays optional and remains easy to add or change after a chat starts. Linked chats remain available on every client.

## Scope

Add a project-aware issue picker, durable chat association, branch/worktree setup and reuse, and issue creation through the existing Linear panel. Improve the Linear integration settings using the same components, spacing, and typography as other settings sections.

The new Linear controls are desktop-only and require both the feature setting and a configured Linear integration for the selected project. Desktop connections to local, remote, relay, and tunnel environments remain supported. In branch discovery, “remote” means GitHub; selecting an issue does not move the chat to another T3 environment. Web and mobile retain access to linked chats without gaining the desktop Linear controls.

This extends the [embedded Linear view](linear-view.md) with issue queries and explicit chat associations. Rebuilding Linear's issue editor, general-purpose Linear agent tools, and migrating existing worktree directories are outside scope.

## Delivery in two PRs

1. **OAuth and existing issues:** Deliver connection management, assigned issues and search, persistent associations, exact Linear branch naming, worktree setup/reuse, existing-chat conflict handling and settlement, running-agent guards, cross-client chat compatibility, and settings styling. This PR is usable independently. Do not expose the picker’s **Create new issue** action until PR 2 delivers its complete flow. OAuth application registration and callback configuration are prerequisites for end-to-end verification.
2. **Issue creation:** Add the sticky **Create new issue** action, opening the existing Linear panel's creation flow, reliable identification of the created issue, and automatic association or replacement confirmation. Reuse PR 1's setup and running-agent guards. This PR depends on PR 1; creation-completion detection must be resolved and verified before it is ready.

PR 1 covers acceptance criteria 1–3 and 5–8 for existing-issue flows, excluding the create action, creation completion, and creation-related races. PR 2 covers criterion 4 and those deferred creation-specific portions of criteria 1 and 8. The following requirements describe the combined result; the split does not remove them.

The subsequent picker refinement adds the three issue-view tabs and fluid active-tab transition (criteria 9–10), and makes the creation action's persistent bottom-right placement explicit in criterion 1.

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
- Place a separate compact team-select component immediately before the search field in the top row. Default to **All teams**; a chosen accessible Linear team filters every view and search on the API. Save the selection per environment/project/workspace on this device across picker openings, chat changes, and app restarts. **All teams** clears the filter. If a saved team becomes unavailable, keep the restriction visible until the user chooses another team or All teams; never silently broaden it. Load all accessible team pages, and offer retry when loading fails. Opening the picker always focuses the search input, not the team selector.
- Open the team menu below its control when space allows, adjusting to the viewport as needed. Do not align the selected team over the trigger in a way that hides earlier options; **All teams** must remain reachable after selecting a team.
- Keep the picker at its full populated height, capped by the available viewport space. Switching tabs or teams, searching, loading, and empty/error states must not resize the outer panel. Let the issue list fill the remaining space and scroll independently of the search, tabs, and creation footer.
- Keep the search row at the top, followed immediately by a single row of three labeled tabs: **Assigned to me**, **Triage**, and **All issues**. Default to **Assigned to me** on the first opening for a chat; preserve the selected tab when reopening that chat's picker during the current session.
- **Assigned to me** shows issues assigned to the connected OAuth user and uses a grey todo-list icon. **Triage** shows accessible issues in Linear's Triage state, regardless of assignee, and uses an orange sorting icon. **All issues** shows accessible issues across the configured workspace, including unassigned issues and those assigned to other people; use a blue layered-issues icon. These views are further restricted by the selected team, when set. Sort every view and search by activity (Linear `updatedAt`, newest first) on the API before pagination. Keep that ordering across loaded pages. Fetch the next page automatically as the list nears the bottom, with one request in flight per page, a loading indication, deduplication, and a recoverable retry on failure. There is no **Load more** button; the creation footer remains outside the scrolling list.
- Search filters the selected tab's issue set. **All issues** provides workspace-wide search. Preserve the search text when switching tabs and make its scope clear in the placeholder. Changing the team, view, or search resets pagination and list scroll; a stale response from another tab or query must not replace the current results or leave unrelated issues selectable.
- Pin a **Create new issue** CTA at the bottom-right of the picker in a footer outside the scrolling results. It remains visible in all three tabs, during search, loading, empty/error states, and while agents run. If creation is unavailable or already pending, disable the CTA and show the reason rather than hiding it. Infinite scrolling must not replace or push the CTA out of view.
- Render the active tab as a rounded bubble that smoothly slides between tabs, briefly stretches toward the destination, and softly settles, producing the requested water-like transition. Animate only on a tab change, approximately 180–240 ms, with no idle animation, layout jump, or delayed interaction. Respect reduced-motion preferences with an immediate selection change. Use a lightweight transition that does not continuously repaint the picker.
- Provide keyboard-operable tabs with visible focus, selected-state semantics, and text labels; color is supplementary. Search and tab browsing remain available while an agent runs, while issue selection and **Create new issue** remain disabled with the running-agent explanation.
- From search, **Arrow Down** focuses the first enabled issue. Within the list, **Arrow Up/Down** moves focus through issues, including newly loaded pages; **Arrow Up** from the first issue returns to search. **Arrow Down** at the last loaded issue stays there without wrapping. Keep the focused issue visible and let **Enter** select it. Empty or disabled results leave focus in search; navigation alone never selects an issue.
- Selecting an issue initiates setup directly in the chat. There is no generic confirmation or link-only/setup decision inside the picker. Show setup progress and failures in the chat.
- In an existing unlinked chat, selection updates that same thread with the issue, exact branch, and resolved worktree. Keep its thread ID, URL, messages, and conversation history; do not create a replacement chat or navigate to a new-chat screen. Promote an unsent draft using its reserved thread ID, preserving its composer contents.
- After successful setup, open the selected issue’s URL in the current chat’s Linear right panel. Reuse and retarget its existing Linear tab, or create the tab if absent. A pending conflict or failed setup leaves the panel and working context unchanged. If only panel opening fails, retain the successful association and explain that the issue was linked but the panel could not open.
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

- **Create new issue** reuses the chat's existing Linear tab in the right panel, or opens it if absent, and initiates Linear's issue-creation flow. Preserve the originating chat and any draft while the user works in the panel.
- When creation initiated from this action succeeds and the originating chat has no issue, associate the new issue automatically and run the same branch/worktree setup as picker selection, subject to the running-agent guard.
- If the chat already has an issue, ask whether to switch to the newly created issue. Acceptance replaces the association and creates or reuses the new issue's branch and worktree for this same chat. Apply the existing-chat conflict rules if necessary. Declining preserves the current association and working context; the created Linear issue remains available.
- Canceling creation does not change the chat. Do not infer successful creation merely from opening the panel or navigating to an unrelated issue.

## Acceptance criteria

1. A configured desktop project with the feature enabled offers the picker before and after the first message. Assigned issues load initially; searching **All issues** finds an issue assigned to someone else. **Create new issue** remains pinned at the bottom-right while scrolling and paginating, including in loading, empty, error, and running-agent states (disabled with an explanation when unavailable). A chat can proceed without an issue.
2. Select issues whose suggested branches have an existing worktree, only a local branch, only a GitHub branch, and no branch. Each resolves to the appropriate working context without picker confirmation, retains Linear's exact Git branch name, and creates directories under the owning environment's T3 home when needed.
3. Reusing a settled chat's worktree preserves that chat and links the current one directly. For an unsettled chat, each modal choice has the specified effect; **Use this chat** settles the previous chat and preserves the shared worktree. Cancel and failed setup do not prematurely settle it.
4. Create an issue from an unlinked chat, then from a linked chat. The first associates and sets up automatically. The second asks to switch; accepting moves the same conversation to the new issue's working context, while declining leaves its existing context intact.
5. Open the linked chat from web and mobile and reconnect from another client. Its history and working context remain available. Feature disable/re-enable and unlinking preserve chat history and files. A disconnected Linear account or failed Git setup produces a recoverable error without falsely reporting success.
6. Linear settings use established settings styling, and configuring one project does not change another project's Linear workspace or account selection.
7. **Connect Linear** completes OAuth without asking for an API key, identifies the authorizing account, and enables its assigned-issue list for the configured workspace. Cancellation preserves any existing connection. Expiry refreshes transparently or offers reconnect; disconnect preserves existing chats and issue associations. API authorization does not falsely mark the embedded panel as signed in.
8. With an agent running in the current chat or the target worktree's chat, switching/takeover is disabled with an explanatory message. When agents become idle, the action becomes available without executing automatically. Starting an agent after opening the picker, modal, or issue-creation flow cannot cause a workspace switch or premature settlement.
9. The tabs appear directly below search in the order **Assigned to me / Triage / All issues**, with the grey todo-list, orange sorting, and blue layered-issues icons. Verify each view's issue membership and pagination, search within each view, retained query text on switching, and rejection of stale responses after rapid tab/query changes. Switching tabs never changes the chat's linked issue or working context. Typing and clearing search before its debounce expires must not strand an initial load or a pending page.
10. Mouse and keyboard tab changes move the active bubble with a brief fluid stretch-and-settle transition. Labels remain readable, focus stays visible, and the list/footer do not jump. With reduced motion enabled, selection changes immediately. No animation runs while idle; the CTA stays at the bottom-right throughout.
11. Select an issue in an existing, idle, unlinked chat with prior messages: the thread ID, URL, history, and thread count stay unchanged; its issue, branch, and worktree update; the right panel opens that exact issue. Repeat with an existing Linear tab and verify it is reused. An unsent draft promotes to its reserved thread without losing text or creating another draft, including when the user leaves and returns before issue creation finishes. Keep a visible draft alive until navigation to its saved thread completes; background completion must not navigate away from another chat. Setup conflicts/failures do not open the issue panel, while a panel-only failure preserves the linked context and explains the partial success.

12. Choose a team in the separate selector before search: all tabs and searches contain only that team’s issues. Reopen the picker, switch chats in the same project, and restart the app: the saved team remains selected. Other projects/workspaces retain their own choices. Reopen the team menu with a team selected and the picker near the top of the viewport: **All teams** remains reachable and clears the restriction. Team-load failure is retryable without losing the saved choice. Search receives focus whenever the picker opens.
13. In every tab, with and without search/team filtering, issues arrive ordered by latest update descending. Scrolling near the bottom loads the next page without a button or duplicate requests. A page failure retains loaded issues and offers retry; changing a filter discards stale page responses, resets the cursor/scroll, and preserves the bottom-right creation CTA.
14. Compare the picker with many issues, one issue, no matches, a pending load, and an error, then switch tabs and teams: its height and footer position stay constant for the same viewport. On a shorter viewport, the panel fits the available space and the results remain scrollable.
15. With search focused, press **Arrow Down**, move through issues in both directions, and continue into an appended page. **Arrow Up** from the first issue returns to search; **Arrow Down** from the last loaded issue does not wrap. **Enter** selects the focused issue, while arrow navigation alone leaves the linked issue unchanged. Repeat with empty results and while an agent runs: focus stays in search when no issue can be selected.

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

## Creation adapter constraint

Creation is correlated with a submission from the editor opened by T3, the exact issue UUID
in its successful `issueCreate` response, and an OAuth API lookup in the configured workspace.
A changed editor or mutation protocol must produce a recoverable error, never guess from
navigation or the newest issue. OAuth remains read-only.

OAuth implementation default, not a separately confirmed product decision: keep the personal connection and API requests on the desktop, with project bindings keyed by environment and project. Remote environments receive the issue association and Git setup request without receiving OAuth tokens. The fork’s OAuth application and local callback have been configured and sign-in was verified during the original implementation. Recheck the final desktop build before release; use `http://127.0.0.1:47289/linear/callback` for the registered local callback.
