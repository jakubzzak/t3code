# Background agent browser

## Problem and outcome

When an agent uses the browser, T3 Code pulls the agent's tab into view. The right panel switches to it, or the floating mini player pops up, while the user is reading or working on something else. The opposite also fails. When the agent does need the user, for example to sign in on three tabs, nothing reliably shows those tabs. The reveal is best-effort, the agent sees `visible: false`, and its next attempt times out. Agents with desktop control have then clicked through T3 Code's own window to reach the browser, which selected a different chat.

The user wants agents to browse in the background, watch only when they choose to, and be brought to the browser reliably when the agent needs them, such as for a login, consent, or confirmation. The user also wants to keep Codex Computer Use, but only after the agent gets permission in each chat.

## Scope

Change when agent browser tabs become visible, add a way for the user to watch on demand, and add a "needs you" state that may bring the browser forward. Limit Codex Computer Use permission to a single chat. Applies to every client that shows agent browser tabs or approvals: desktop, web, and mobile.

Keep the existing browser. Agent tabs already run without a visible window and can use saved browser profiles, which keeps logins. Out of scope: a separate dedicated browser, detecting login or consent pages automatically, and switching the selected chat.

## Required behavior

- **Background by default.** Opening, navigating, or acting in an agent tab never switches the active right-panel tab, never opens the mini player, and never takes focus. This includes `preview_open` with `open: true` or `show: true`.
- **Indicator.** While a thread has agent browser tabs, the thread shows an indicator with the agent's current page. Clicking it opens a live view of the agent's tab.
- **Following.** Once open, the view follows the agent through navigation, newly opened tabs, and later turns until the user closes it. Closing the view does not stop or slow the agent. The tab returns to the background, and the indicator remains so the user can watch again.
- **Needs you.** A tab enters a "needs you" state when:
  - the browser hits an interruption the agent cannot resolve by itself: a page dialog, file chooser, or permission prompt; or
  - the agent explicitly asks for the user through a new browser tool, giving a short reason such as "Sign in to staging". Agent guidance tells agents to use this tool for logins, consent, CAPTCHA, and confirmations instead of attempting them, and never to use desktop control on T3 Code's window to reach the browser.

  While in that state, the agent waits. The request stays pending until the user resolves or declines it, or the turn is stopped. It does not time out or fail because nobody is watching.
- **Bringing it forward.** When a tab needs you and the user is viewing that thread, the browser is shown and focused with the reason visible, ready for the user to take control. This happens regardless of the auto-show setting, the panel layout, and whether the tab is already a panel tab. This is the only case where the browser takes over the view.
- **Several requests.** Each tab's request is tracked separately. The browser brings forward the earliest pending request; when it is resolved or declined, the next one comes forward. The thread stays in the attention state until none are pending.
- **Other threads.** When a tab in another thread needs you, that thread shows the existing attention status in the sidebar and sends the existing thread notification. The current chat is never switched or interrupted. The browser comes forward when the user opens that thread.
- **Resolving.** Releasing control after completing the step returns control to the agent with the outcome. The user can also decline, which tells the agent the step was declined. Either way the "needs you" state clears: the badge and notification are removed, and the view stays open only if the user was already following.
- **Logins persist.** Sign-ins completed during a handoff are stored in the tab's browser profile and are available in later agent runs that use that profile.
- **Computer Use permission per chat.** When a Codex agent wants to control an app with Computer Use, the chat asks first, naming the app. The choices are allow once, allow for this chat, and decline. Nothing grants permission beyond one chat: T3 Code does not offer Codex's "for this session" or "always" choices.
  - "Allow for this chat" covers that app in that chat only. Later requests for that app in the same chat are approved without asking. Other apps, and other chats, still ask.
  - The user can revoke the chat's Computer Use permissions from that chat. The next request asks again.
  - A pending request behaves like other approvals: the agent waits, and in another thread it shows the attention status and a notification without switching chats.

## Acceptance criteria

1. While the user reads another right-panel tab, the agent opens and navigates a page, including with `open: true`. The panel tab does not change, no mini player appears, and the thread indicator shows the agent's page.
2. The user opens the live view from the indicator and sends another message. In the next turn the agent opens a second tab, and the view follows it without reopening. After the user closes the view, the agent keeps browsing and the indicator remains.
3. In the visible thread, the agent asks for a login. The browser comes forward with the reason. The user takes control, signs in, and releases control. The agent continues signed in. In a later run with the same profile, the agent is still signed in.
4. While the user is in thread A, the agent in thread B hits a page confirmation dialog. Thread A stays selected and undisturbed. Thread B shows the attention status and a notification is sent. Opening thread B shows the browser with the dialog.
5. The user declines a "needs you" request. The agent is told it was declined, and the attention status and notification clear.
6. In the visible thread, with auto-show off, the agent requests sign-in on three tabs. The first comes forward. After the user signs in and releases control, the second comes forward, then the third. No request times out while waiting, and the attention status clears after the last one.
7. An agent that has desktop control needs a sign-in. It uses the "needs you" request, and the user's selected chat and panel are untouched until the request comes forward.
8. A thread viewed from a remote web or mobile client behaves the same way: no automatic reveal, watching from the indicator, and the browser brought forward only for "needs you".
9. In chat A, the Codex agent asks to use Computer Use on Safari. The user chooses "Allow for this chat". Later Safari actions in chat A run without asking. A request in chat A to control T3 Code still asks. A Safari request in chat B asks again.
10. The user revokes chat A's Computer Use permissions. The next Safari request in chat A asks again.
11. While the user is in chat A, the agent in chat B asks to use Computer Use. Chat A stays selected. Chat B shows the attention status and a notification is sent. Declining tells the agent no, and the agent does not control the app.

## Constraints and decisions

- Agent tabs run in the server's shared browser and are mounted in the desktop app when one is attached ([ServerBrowser.ts](../../apps/server/src/preview/ServerBrowser.ts)). Today's reveal comes from `requestReveal` and the auto-reveal effect in [ChatView.tsx](../../apps/web/src/components/ChatView.tsx).
- Today a reveal only records a request; whether a client acts on it depends on the auto-show setting and on that thread being open. `visible` in preview status only reports whether any client is currently showing the tab ([ServerBrowser.ts](../../apps/server/src/preview/ServerBrowser.ts)). Agents therefore cannot get the user's attention reliably by revealing a tab, which is why "needs you" is an explicit request that waits for an answer.
- Codex asks before Computer Use controls an app, and T3 Code already shows that question in the chat ([CodexMcpElicitation.ts](../../apps/server/src/provider/CodexMcpElicitation.ts), handled in [CodexAdapterV2.ts](../../apps/server/src/orchestration-v2/Adapters/CodexAdapterV2.ts)). Today it passes on Codex's "for this session" and "always" choices. Chats share one Codex app-server, so a session grant can carry into other chats. Per-chat permission therefore has to be remembered by T3 Code per thread and app, and answered to Codex as a one-time approval.
- An "always" grant already stored by Codex means Codex never asks, so T3 Code cannot gate those apps. The user guide must say how to clear them in Codex.
- Per-chat permission covers Codex Computer Use only. Other providers' desktop control is not affected by this spec.
- Giving agents a "needs you" request that reliably works, plus guidance, removes their reason to drive T3 Code's window. Per-chat permission is the user's control when they still try.
- Reuse the existing take/release control flow ([SessionControl.ts](../../apps/server/src/preview/SessionControl.ts)) and the existing pending-dialog pause for handoffs. Reuse the sidebar's attention status and the thread notification coordinator rather than adding a separate alert system.
- The "ask for the user" tool is a T3 MCP browser tool, so it works the same for every provider. Guidance for it lives with the other orchestration instructions.
- "Needs you" is limited to signals the browser detects and explicit agent requests, because guessing at login or consent pages is unreliable in both directions.
- Only the "needs you" state may take focus. Desktop code that focuses a page's web contents during agent work (for example, element picking in [desktop Manager.ts](../../apps/desktop/src/preview/Manager.ts)) must not bring the app or panel forward.

## Open questions

- Non-blocking: if the user asks the agent in chat to show what it is doing, should that reveal the browser? The default assumption is no: the user opens the live view from the indicator, and agent reveal requests never change the view.
- Non-blocking: should the existing "auto-show floating preview" setting stay as an opt-in to the old behavior, or be removed?
