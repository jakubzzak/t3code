# Unattended browser automation

## Problem and outcome

Agents sometimes time out clicking controls or waiting for popovers while the browser panel is hidden. Showing the panel appears to unblock some interactions, leaving users responsible for watching unattended work. Browser automation must make progress without a visible browser panel or a foreground desktop window.

The reported interaction has not been reproduced. Source inspection identifies a plausible rendering and throttling gap; the required outcome does not depend on that diagnosis being the only cause.

## Scope

Keep existing browser automation functional while its view is closed, another tab or thread is selected, or the hosting desktop window is minimized or obscured. Cover desktop-hosted tabs and preserve the server's headless path, including work initiated or observed from remote web and mobile clients. The behavior is shared by providers and scheduled turns using the existing preview tools.

This spec concerns execution, not when browser tabs are revealed. It adds no indicators, attention requests, permission choices, or browser engine. Existing human-control and approval rules remain in force. Machine sleep, quitting the hosting app, and loss of the host or network are outside the availability guarantee.

## Required behavior

- **Progress without watching.** During agent browser work, page rendering, animation frames, timers, and input processing needed by navigation, clicks, typing, and waits continue regardless of panel visibility or window focus. A newly opened background tab and a tab hidden midway through an interaction behave the same as a watched tab.
- **No visibility workaround.** Keeping automation operational must not open the panel or mini player, select a different thread or tab, restore a minimized window, or steal keyboard focus. Explicit viewing and existing handoff behavior retain their normal semantics.
- **Complete asynchronous interactions.** A click that starts an animation or schedules a delayed popover update must be able to finish while hidden, including between consecutive tool calls. Keeping a tab active only for input dispatch is insufficient. Returning a successful click must not imply that a later requested condition has already been reached; normal condition checks still apply.
- **Bounded resource use.** Keep the necessary tab active for browser work and return it to normal idle behavior when that work ends. Merely retaining an agent-owned tab must not keep it rendering indefinitely. Completion, failure, cancellation, tab closure, and host teardown release temporary activity. Concurrent tabs and recording or picture-in-picture sessions must not disable one another's required rendering; the final release restores ordinary idle policy.
- **Preserve ownership and recovery.** Visibility changes never transfer control. Human takeover still interrupts or blocks agent input through the existing control mechanism. Navigation and replacement of a guest renderer must preserve activity needed by ongoing work or return the existing explicit interruption/error, without requiring the user to reveal the browser. Actual page errors and unavailable hosts remain errors rather than being reported as successful actions.

## Acceptance criteria

1. In the actual desktop browser, open a background fixture with an animated dropdown and a control enabled after an animation-frame update. Use ordinary preview click/type/wait tools to select an option and confirm the resulting value without ever opening the panel. The flow completes within the same configured tool deadlines used while visible.
2. Start the same flow visibly, then close the panel, select another thread, and minimize or obscure the desktop window in separate runs. The remaining interactions complete; the selected UI and user focus stay unchanged. Reopening the view shows the resulting page state.
3. Run two background tabs concurrently. Finish or cancel one while the other is waiting for an animated update. The remaining tab completes. Repeat with recording or picture-in-picture overlapping automation and stopping in either order; no remaining consumer loses rendering, and normal idle policy returns after all work ends.
4. Exercise navigation, guest replacement, a failed action, cancellation, tab closure, and human takeover. No activity remains leaked after cleanup, no input reaches another tab or application, and interrupted work reports its actual outcome. Idle tabs do not acquire continuous rendering solely because an agent owns them.
5. Run the hidden interaction through a remote client connected to a desktop host and with the server's headless browser when no desktop is attached. Closing the viewing client does not stop host-side work. Neither route requires a viewer, a recording, or a visible window to pass.

## Constraints and decisions

- [ServerBrowser.ts](../../apps/server/src/preview/ServerBrowser.ts) prefers a desktop-hosted page when a desktop is attached. A passing headless test therefore does not prove the affected desktop path works; acceptance requires real Electron execution.
- [Hosted browser layout](../../apps/web/src/browser/hostedBrowserWebviewStyle.ts) documents that fully offscreen guests can stop compositing even with background throttling disabled. [HostedBrowserWebview.tsx](../../apps/web/src/browser/HostedBrowserWebview.tsx) already distinguishes rendering activity from visible presentation. The solution must address both rendering eligibility and background throttling without coupling them to whether the user watches.
- [Desktop preview Manager](../../apps/desktop/src/preview/Manager.ts) manages rendering activity for recording and picture-in-picture. [Browser recording](../../apps/web/src/browser/browserRecording.ts) acquires a surface activity lease. Coordinate with existing activity lifetimes rather than applying competing unconditional enable/disable changes.
- Do not disable throttling globally for every retained tab, add perpetual screenshots or polling to keep pages alive, force clicks past actionability checks, or increase timeouts to hide stalled rendering. Preserve normal resource-saving behavior outside active work. After native testing showed throttling and layout alone were insufficient, the user approved a bounded native frame subscription on 2026-10-30: subscribe only during active browser work and its short idle grace, discard frames without encoding or saving, and release the subscription with activity cleanup.
- Verify observable animation and interaction progress, not only mocked activity calls or configuration values. Tests must demonstrate cleanup as well as successful hidden execution.

No blocking product questions remain. The precise activity lifetime and the reported page's failure mechanism require implementation-time investigation; they are not established by the earlier headless probe.
