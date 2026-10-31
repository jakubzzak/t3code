# Linear agent identity in the original preview

## Problem and outcome

The original Linear notification preview initially fails to identify Tars as an agent, and the existing “Agent thread · Tars” headline is unnecessarily long. Show verified identity immediately using the existing notification style and the compact label **Agent · Tars**.

Tracking: intentionally no separate Linear issue, confirmed on 2026-10-31. This refines [Inbox agent thread indicators](inbox-agent-thread-indicators.md).

## Scope and required behavior

- In the original Linear source preview, prefix **Agent · <actual agent name>** with the existing bot icon. Retain the current cyan color, typography, inline Comments placement, spacing, tooltip and activity treatment; do not introduce an emoji, new badge or header row.
- Include verified session identity in initial source data so recognition does not depend on expanding history or waiting for the separate activity request. Use stable Linear IDs and the relevant comment thread; support Tars and other agents without name matching.
- Preserve identity when the latest reply is human. Unrelated agent threads, ordinary comments, generic integrations and humans named Tars must not become agent threads.
- Keep live activity separate from initial identity: initial or cached identity alone must never imply current work. Preserve bounded visible-only activity refresh, expiry, neutral failure behavior and recovery.
- Apply the shared behavior in web/desktop Inbox and linked-chat Details, including remote environments. Native mobile Inbox remains deferred by the parent spec; provider adapters and source mutations are outside scope.

## Acceptance criteria

1. Opening a notification whose preview contains verified session metadata immediately shows the existing bot icon and **Agent · Tars**, before an activity response or history expansion. Another agent shows its own name.
2. The initial agent comment uses the existing bot avatar, including when identity is supplied by the verified session. A human latest reply retains the thread label and its human avatar; same-name humans remain human.
3. Ordinary or unrelated threads show no agent label. Opening an old cached record refreshes missing identity metadata once, retains its content if that read fails, and retries on a later read. Fresh metadata then avoids repeated history reads. The existing live lookup remains a fallback.
4. Fresh live status still controls the working indication; delayed, failed, inactive or expired status cannot make initial identity appear active. Opening/closing history and reopening the preview preserve correct identity and reply behavior.
5. Normal and narrow layouts retain the current notification styling without overflow or an additional headline row. Inbox and Details render consistently.

## Compatibility and recovery

Any wire additions are optional and additive. Older cached records and clients stay readable; no database migration, new credentials or source writes are required. Keep source reads bounded and avoid per-row activity polling. Roll back by reverting the implementation and releasing the previous application build; retained optional identity metadata must not affect older clients.

## Open questions

None blocking. “Original preview” refers to the existing original source-content view, including its latest-comment preview; the compact Inbox list and AI summary are not being redesigned.
