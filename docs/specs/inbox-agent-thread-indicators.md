# Linear agent identity and activity in Inbox

## Problem and outcome

Linear agent conversations look like ordinary comments in Inbox. Make the agent's identity and current work visible without another header row or repetitive labels. This extends the [Inbox spec's Linear notifications scope](project-notification-inbox.md) and [shared Inbox/Details conversation](inbox-inline-replies.md).

Tracking: use the existing Inbox spec, as requested on 2026-10-31; no separate Linear issue.

## Scope

Apply the same presentation to web/desktop Inbox and linked-chat Details, including remote environments. Native mobile Inbox remains deferred by the parent spec. This is read-only source integration: no source comment deletion, agent control, new credentials, or provider-adapter changes.

## Required behavior

- Show a bot icon and cyan **Agent thread · Tars** inline beside **Comments** for a verified Linear agent session in the notification's relevant comment thread. Use the actual agent name and stable identity, not a hardcoded Tars account or name matching. Preserve the agent name on narrow layouts without adding a row. Ordinary discussions and generic integrations must not acquire an agent-thread label merely because an agent commented elsewhere on the issue.
- Replace verified agent authors' initials with a cyan bot avatar. Keep their normal author name and timestamp, with an accessible agent description. Do not add per-comment Agent chips. Human authors retain their existing presentation, including a human with the same display name as an agent.
- Hide Linear's verified artificial session-root introduction from the displayed conversation, and exclude it from the displayed comment count. Preserve its source identity and parent relationships for session lookup and replies. Keep genuine Linear-authored comments and user-written lookalike text. Do not modify or delete anything in Linear.
- Add a small cyan pulsing dot immediately after the agent's name in the existing Comments headline only while that relevant session is confirmed **active**. Keep the identity visible when inactive. Pending, stopping, awaiting input, complete, error, stale, missing, inaccessible, or expired status must not pulse. Provide an accessible working description and a static dot under reduced motion.
- Refresh status while the relevant source conversation is visible, including a conversation whose latest reply is human. Stop background refresh when hidden, collapsed, disconnected, or unmounted. Use bounded source requests, share in-flight refreshes where appropriate, and expire the working indication if fresh status cannot be obtained. Opening history, replying, and regular source refresh must not resurrect an older working state or reset expanded history and drafts.
- Use Linear's explicit session/actor IDs and session status. Neither recent comments, assignment alone, display names, generic bot metadata nor the session-introduction sentence proves current activity. Unsupported metadata must leave normal source browsing usable and activity neutral; a later successful refresh recovers without reconnecting or reloading the app.

## Acceptance criteria

1. A verified agent session shows the inline cyan identity and bot avatars in both Inbox and Details. A human reply shown alone still retains the relevant thread identity. No extra header row or Agent chips appear at narrow and normal widths.
2. Human, generic bot, same-name human, and unrelated issue-thread fixtures remain ordinary. All verified agent replies match their actual author IDs.
3. The verified artificial introduction disappears and the displayed count excludes it, while real comments, lookalike text, source history pagination and reply targeting remain intact.
4. Active status starts the dot; every other status, failed refresh, disconnect, or expired observation stops it. A later active observation restores it. Old history payloads cannot overwrite newer activity observations. Reduced-motion mode retains a static working dot.
5. Refreshing is bounded to visible conversations, handles multiple readers without duplicate simultaneous source work, and preserves the user's history expansion, scroll position and reply draft. Local and remote clients use the destination environment's existing connection and authorization.
6. Existing cached records and older clients remain readable. Missing new optional metadata yields the ordinary presentation until refreshed; no destructive data migration is required. Rollback removes the presentation without altering Linear or existing Inbox state.

## Constraints and decisions

Use the existing environment-owned Linear connection and service boundary, typed optional contract additions, and source-content component shared by Inbox and Details. Avoid refetching full comment history merely to update activity. Animation may change only opacity/transform, must respect reduced motion, and must not run offscreen.

Linear exposes explicit [agent session state](https://linear.app/developers/agent-interaction#session-states). Agent-specific webhooks go only to the owning agent, so this reader must not assume it receives Tars's agent webhooks. Validate available read metadata and preserve a neutral fallback if an account or API does not expose it.

Non-blocking implementation choices: poll visible session status at a modest bounded interval, with a short freshness expiry, using synthetic integration fixtures and deterministic clocks for automated tests. The accepted design is recorded in the conversation's refined interactive prototype; do not commit prototype or PR-only evidence assets.
