# Embedded Linear view

## Problem and outcome

T3 Code users need to inspect and edit Linear issues alongside their coding threads without leaving the desktop client. Show Linear's actual issue interface so its details, editor, and behavior stay aligned with Linear without maintaining a duplicate implementation.

## Scope

Add an embedded Linear surface, project workspace settings, best-effort login assistance, and a Settings → Features page with an initially disabled Linear view flag. Web and mobile expose the unavailable surface but cannot open it.

Linear API authentication, API tools, and agent API workflows are deferred. Do not substitute browser automation for those workflows. Rebuilding Linear, fixing passkeys, redesigning the general Browser surface, and moving existing features behind flags are outside this change.

## Required behavior

### Availability and entry points

- Replace the **Linked pull requests** item in the surface picker with **Linear**, its logo, and the **L** shortcut. Apply the replacement wherever that picker is offered. This removes the picker entry, not the underlying PR associations or the separate Pull request surface.
- Keep the surface tab label fixed as **Linear** throughout navigation, including issue pages, My Issues, login, and Google authentication. Do not adopt the embedded page's document title.
- L opens Linear only in the existing surface-selection shortcut context; it must remain ordinary text while typing in chat or inside Linear.
- Enable the surface only in the desktop client with its feature flag enabled. Desktop access remains available when connected to a remote environment; support depends on the client, not the server location.
- On web and mobile, keep Linear visible and disabled with the exact explanation **Available only in the desktop app**. Use the same wording in Features. On desktop with the flag off, explain how to enable it in Settings → Features. Shortcuts and agent opening actions obey the same availability rules.
- Render the actual Linear website using the existing embedded-browser capability. Do not show a T3 browser toolbar, URL input, navigation icons, hover controls, or browser utility actions. Retain normal surface closing and layout controls and Linear's own interface.

### Workspace and navigation

- Add a dedicated Linear section under Settings → Integrations. Order the integration sections alphabetically: Browser (including its agent-access settings), Devices, then Linear. Select or enter the Linear workspace for each project; one project's choice must not change another's.
- On initial opening, use the thread's branch to find a Linear issue identifier. For example, `jakub/eng-123-fix-login` opens ENG-123 in the configured workspace. If the branch has no identifier, open that workspace's My Issues view.
- Once open, preserve the current page and user navigation. Rerenders, returning focus, and branch changes must not retarget an existing surface or interrupt editing. Closing and opening a fresh surface resolves the initial destination again.
- Restrict the dedicated surface to the exact HTTPS origins `https://linear.app` and `https://accounts.google.com`. Reject other origins, including redirects, popup navigation, and agent navigation. Generic Browser opening must not implicitly reuse a Linear surface for another origin. This restriction does not apply to ordinary page assets; the fixed Linear label must never conceal an unrelated navigated page.
- An explicit user request to show a particular issue may open that issue in the Linear surface without a second confirmation. Agents must not open it proactively for routine research, search, or editing. The narrow login assistance below is the browser-automation exception in this scope.

### Login

- Reuse persistent browser-session support so closing a surface or restarting T3 does not deliberately discard the login. Linear may still require reauthentication.
- Default the login email to the T3 account email when available. Provide a project-specific Linear login-email override in the integration settings; it takes precedence. Disable its setting until a project is selected, and show a saved override only for its owning project. Resolve it from the surface's project, not the Linear workspace or a device-wide email value. Without either email, leave email entry manual.
- When Linear's login screen appears, use T3’s bundled Playwright browser runtime to attempt Continue with Google, fill the resolved email when available, and click Next. Attach to the embedded session rather than completing login in an unrelated browser session.
- Permit autofill only on the exact approved Linear or Google origin and the expected login form. Validate the actual document at the write/submission boundary, and abort if navigation replaces it; a previously reported URL is insufficient. Preserve the Google email-step flow above rather than filling arbitrary email inputs on those sites.
- Leave subsequent authentication, including passwords, account challenges, and 2FA, to the user. If assistance fails, stop silently and leave the page usable for manual login. Do not loop retries or keep overwriting user input.

### Feature settings

- Place **Features** second to last in Settings navigation, immediately before **Archive** (Archived Threads on native mobile).
- Add Settings → Features as a list of explicitly registered optional features. New feature flags default to disabled; Linear view is the first flag introduced here.
- Enabling Linear view makes the desktop entry usable. Disabling it prevents new opens and closes an existing Linear surface without deleting workspace configuration, email preferences, or the persistent login.

## Acceptance criteria

1. A fresh installation shows Linear view off in Features. Features is the second-to-last Settings item, immediately before Archive; Integrations sections are alphabetical. Linear replaces Linked pull requests in the picker. Enabling the flag allows desktop activation with L in the surface-selection context; L in an editor remains text. Web and mobile always show the entry disabled.
2. Two projects configured for different workspaces open their respective destinations. A branch containing ENG-123 opens that issue; a branch without an identifier opens My Issues. Branch changes and focus changes leave an already-open page untouched.
3. A user can read and edit an issue using Linear's own interface with no T3 browser chrome, including while the desktop client is connected to a remote environment. Normal surface closing remains available, and the tab stays labeled Linear even on Google sign-in or after navigating to another issue.
4. A signed-out session attempts the Google email step using its project's override or account email. The override setting is disabled without a project selection; switching projects displays and uses only the relevant project's override. Missing email or an automation failure permits manual login; 2FA remains user-controlled. Autofill cannot write to another origin or a replacement document. Closing and reopening retains a valid session.
5. Turning the flag off closes the surface and disables all opening paths. Turning it back on preserves configuration and login. An explicit request to show an issue can open it without another approval, while routine agent work does not browse Linear.
6. Links, redirects, popups, and agent navigation cannot take the Linear surface outside `https://linear.app` and `https://accounts.google.com`. Inspecting a mixed project-workspace setting without editing it does not change any saved value.

## Constraints and decisions

- Reuse the existing browser and surface lifecycle rather than introducing a second browser host. Preserve general Browser behavior and avoid background work for a disabled feature.
- Keep project configuration scoped to the owning environment and project. Browser sessions live on the desktop client; the server's location must not determine the browser login.
- Existing browser profiles contain a name and session identity, not an email. Do not assume a browser profile supplies the account email or establishes API credentials.
- Validate the login helper against the actual embedded session before claiming compatibility. A failed helper must not block ordinary use of the view.
- This spec intentionally supersedes the L → Linked pull requests mapping in the earlier keyboard-section-navigation spec for this picker.

## Assumptions and open questions

These defaults are non-blocking assumptions to review during implementation:

- The Linear view flag is device-local. Its scope was proposed during discussion but was not separately confirmed.
- Without a configured workspace, opening Linear shows a setup prompt linking to the project's Linear settings rather than guessing a workspace.
- If a branch contains multiple issue identifiers, use the first complete identifier in branch order. If Linear cannot resolve an identifier, preserve Linear's own error or access-denied page rather than silently choosing a different issue.
- Attempt login assistance once per login flow. Keep the project-specific email override in the local user's configuration, keyed by owning environment and project, rather than sharing a person's email preference across remote users.

## Accepted security risks

### SEC-003 — Automatic browser clipboard/location permission (P2 / Medium)

- **Decision:** Accepted by the maintainer (Jakub, this thread) on 2026-10-05. In response to the review's three risks, the maintainer requested origin restriction and origin-bound autofill, and stated “accept risk” for the remaining inherited permission concern. No additional rationale, owner, expiry, or follow-up was specified.
- **Scope and provenance:** Pre-existing permission policy in `apps/desktop/src/preview/BrowserSession.ts` (allowed permission set at line 31 and handlers at line 206), inherited by the Linear surface through `apps/web/src/browser/ElectronBrowserHost.tsx`. Reviewed head: `ccda05493be7dd144f609bbd8216b6e9c13e3b74`.
- **Impact and prerequisites:** Embedded content that reaches this session can request clipboard-read or geolocation permission without origin-specific T3 consent. Malicious or compromised content could obtain clipboard data or location when Chromium's secure-context/focus requirements and relevant OS permissions permit it. Actual OS-level data access was not demonstrated.
- **Evidence:** Both existing permission handlers grant by permission name without checking requesting origin. Focused BrowserSession tests confirm the grants. See [SEC-003 in the review](https://github.com/jakubzzak/t3code/pull/6#pullrequestreview-5414292079) and the maintainer's numbered disposition response in this thread.
- **Residual risk and mitigations:** Sandbox/no Node integration and platform permission constraints remain; they do not replace origin-specific consent. The requested SEC-001 origin restriction will reduce reachable destinations once implemented and verified, but does not remove the accepted permission exposure on allowed content. This acceptance does not accept SEC-001 or SEC-002, and does not mark the inherited policy fixed.

## Tracking

Proceed intentionally without a Linear issue, as approved by the maintainer. The maintainer approved the bundled Playwright runtime in place of the standalone CLI and authorized isolated UI testing and evidence capture.
