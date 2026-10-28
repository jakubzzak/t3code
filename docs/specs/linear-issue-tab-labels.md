# Compact Linear issue tab labels

## Problem and outcome

Every semi-native Linear tab currently says **Linear**, so users cannot distinguish open issues. Show the current issue's identifier and name in a compact label without widening the existing tabs.

## Scope

Apply to the existing desktop Linear surface, including desktop clients connected to remote environments. Preserve the Linear icon, navigation, feature availability, and ordinary Browser tab behavior. Adding Linear support to web or mobile, changing issue content, and redesigning the tab strip are outside this change.

This spec supersedes the fixed **Linear** label requirement for issue pages in [Embedded Linear view](linear-view.md). Non-issue pages retain that generic label.

## Required behavior

- On a recognized issue detail route, show `TEAM-123 · Fix login redirect`. Keep the complete identifier visible and truncate only the original issue name with an ellipsis when necessary, for example `TEAM-123 · Fix login…`. Reuse the existing tab width cap; do not summarize or rewrite the name.
- Hovering the tab reveals the full identifier and issue name using the existing tooltip convention. Visual truncation must not remove text from the tab's accessible name.
- Derive the identifier from the current recognized Linear issue URL. Use a name associated with that same issue from reliable page metadata or structured issue data. The thread's linked issue or branch is not authoritative after navigation inside Linear.
- If the identifier is known but a matching name is unavailable, show only the identifier, with no dangling separator. Never combine a new issue identifier with the previous issue's name. Update the label and tooltip when the matching name becomes available.
- Reflect the current page after initial opening, issue-to-issue navigation, in-page navigation, reload, and back/forward. Each tab reflects its own current issue.
- Keep the identifier during loading or a load failure when the issue URL remains known. A name may remain only while it is known to belong to that same issue. Existing loading and error behavior stays unchanged.
- Return to **Linear** on lists, login/authentication pages, an idle tab, or an unrecognized URL. Do not retain the last issue's label after leaving its route.

## Acceptance criteria

1. Two tabs showing different issues display their respective identifiers and names. A long name truncates with an ellipsis within the existing tab width, the identifier remains visible, and hover reveals the complete text.
2. Navigate from issue A to issue B and then to My Issues. The label follows A, B, and **Linear**. Back/forward restores the appropriate label without reopening the surface, including navigation handled inside the page.
3. Reload an issue while its title is delayed, then exercise a load failure at that issue URL. The identifier remains available; a stale or unavailable name never produces a misleading label. When valid metadata arrives, the full name appears subject to visual truncation.
4. Opening a login page or an unrecognized route produces **Linear**. An issue with unavailable name metadata produces ID-only. Neither case leaks the previous issue's name into the label or tooltip.
5. The same behavior works in the desktop client against local and remote environments. Ordinary Browser tabs, Linear's page content, and the existing availability rules remain unchanged.

## Constraints and decisions

- Reuse the preview URL/title state and existing navigation/title update events. Do not add polling, DOM selectors, or a separate title service to maintain tab labels.
- Prefer the recognized issue URL for identity and matching page metadata for the name. A URL slug is not a reliable substitute for the original issue name. Structured issue data is usable only when it matches the currently displayed issue.
- Preserve origin restrictions and existing surface lifecycle. Label updates must not navigate, reload, or otherwise interrupt the page.

## Open questions

No unresolved product decisions block implementation. Verify Linear's actual page-title format and its ordering relative to URL changes during implementation; the current code supplies both fields but does not establish reliable issue-name extraction. Use the agreed ID-only fallback whenever metadata cannot be safely associated with the current issue.
