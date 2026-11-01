# Inbox integration status

## Problem and outcome

Slack, Superhuman and Linear failures currently put raw red error messages above the Inbox list. Keep those diagnostics in Settings → Integrations and show a subtle status dot inside the Inbox tab instead.

## Required behavior

- Show one small dot when an enabled source in the current project/environment scope has an error. Keep the cue visible while Chats is selected too. Remove the raw source-error rows from the Inbox list; preserve notification content and existing Settings diagnostics.
- Hovering or keyboard-focusing the dot shows a tooltip without navigation. Clicking or tapping it must not select a different tab or open Settings. Support touch disclosure and Escape dismissal.
- Use concise text: `Slack updates delayed · Last synced 14m ago`, substituting the affected service and elapsed time since its last successful sync. Use compact hours/minutes for older times.
- Keep the dot yellow through 30 minutes. Between 30 and 120 minutes, interpolate continuously through orange to red. At and after 120 minutes, keep it fully red. The color changes with elapsed time without a reload or a continuous animation.
- Clear the cue when the error clears or the source leaves the enabled/current scope. An old sync timestamp by itself is not an error.

## Edge-case assumptions

- Multiple failures share one dot using the greatest elapsed delay. The tooltip has one line per affected service; repeated service connections use their oldest successful sync. This keeps the summary compact across projects and environments.
- A missing successful timestamp says `Never synced`; use `collectionStartedAt` for color when available, otherwise the minimum yellow. Invalid timestamps follow the same fallback. Clamp future timestamps to zero elapsed time.
- Reuse the existing source queries and refresh behavior. Only the small status component needs a coarse clock while errors exist; no new server polling or wire fields.

## Acceptance criteria

1. A Slack failure with a last sync 14 minutes ago produces a yellow dot and the concise tooltip, with no raw failure text in the list. Repeat for Superhuman and Linear; Settings retains the detailed error.
2. At 30 minutes the dot remains yellow, at 75 minutes it is orange, and at 120 minutes and later it is red. Advancing the clock updates color and tooltip without navigation or reload.
3. Hover, focus and touch reveal the tooltip; Escape dismisses it. Activating the dot while Chats is selected leaves Chats selected and does not navigate. Normal tab navigation still works.
4. Multiple failures use the worst delay and concise per-service lines. Healthy/disabled sources and duplicate pagination results do not add false or duplicate warnings. Recovery and scope changes remove the appropriate cue immediately.
5. Missing/future timestamps remain truthful and safe. Light/dark themes and narrow layouts retain a legible, unobtrusive cue and tooltip.

## Scope and compatibility

Web and the shared desktop UI, including remotely connected environments. Native mobile has no equivalent notification Inbox. No changes to sync/retry behavior, authentication, agent providers, MCP, schemas or storage; existing clients and servers remain compatible. No migrations are required.

Tracking: intentionally no Linear issue, per the standing Blackbird/T3 Code preference. The implementation PR owns this work.
