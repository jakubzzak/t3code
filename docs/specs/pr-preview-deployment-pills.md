# PR preview deployment pills

## Problem and outcome

Users reviewing a PR must find deployment links buried in GitHub comments before opening a preview. Surface those links below Labels in the PR header so each deployment can be opened in the T3 browser or copied directly.

## Scope

Add a Previews metadata row to the existing web/desktop PR summary, including the standalone PR view and the thread's PR panel. Discover links from GitHub conversation comments only. Deployment APIs, CI checks, PR descriptions, other hostname patterns, and deployment health checks are outside this scope.

## Required behavior

- Keep the Previews row visible even when there are no matching URLs. Once comments have loaded, show exactly “No previews available” when none match. While comments load or fail, preserve the existing activity loading/error conventions rather than presenting an unverified empty result.
- Scan comment bodies using regex for HTTPS URLs whose hostname matches `<deployment>.<service>.staging.jurata.ch`. Both variable parts are single, nonempty DNS labels. Match the complete hostname, not a substring of a different host. Do not depend on the comment author, heading, “Preview URL” wording, or line layout. Support plain URLs and Markdown links; surrounding Markdown delimiters and sentence punctuation are not part of the URL.
- Display each distinct full URL once. Preserve distinct URLs even when they shorten to the same name; do not select only the latest deployment. Refresh the row when refreshed comment data changes, including additions, edits, and removals.
- Shorten only the display text to `<service>.staging.jurata.ch`. For example, `https://prod-2570-checkout-analytics-save-for-later.checkout.staging.jurata.ch` displays as `checkout.staging.jurata.ch`. Opening and copying use the full extracted URL, including any path, query, or fragment.
- Render URLs as pills matching the Labels row's sizing, all in one shared color, with a trailing link icon on each pill. Allow the pills to wrap.
- Left-click anywhere on a pill, including its icon, opens its full URL in the T3 browser. Preserve the PR's environment context. Keyboard activation performs the same action.
- When two or more distinct URLs have the same shortened text, each corresponding pill shows its own full URL in a tooltip on hover. Pills with unique shortened text have no hover tooltip. Recompute collisions when the URLs change.
- Right-click anywhere on a pill immediately copies its full URL, suppresses the context menu, and does not open the browser. Show a success notification only after copying succeeds. Use existing error reporting if copying or browser opening fails; never report success for a failed action.

## Acceptance criteria

1. A comment containing checkout, backstage, and cockpit preview links produces three pills below Labels. Changing the comment heading or using Markdown link text does not change detection. Unrelated documentation URLs and hosts ending in `.staging.jurata.ch.example.com` produce no pills.
2. Two different deployment URLs for checkout remain two `checkout.staging.jurata.ch` pills, each with its own full-URL tooltip. A backstage pill without a collision has no tooltip. Repeated occurrences of an identical full URL produce one pill.
3. Left-clicking a pill or its icon opens the exact destination in the T3 browser. Right-clicking copies that destination and shows success without navigating. A failed clipboard write reports failure without a success notification.
4. With no matching comments, the row reads “No previews available”. Adding, editing, or removing matching links updates the pills after the existing PR refresh, including tooltip eligibility and the return to the empty state.
5. The row works in both PR entry points and retains the correct environment when connected remotely. A PR without an attached thread must not silently ignore browser activation or use an unrelated thread.

## Constraints and assumptions

- Reuse the metadata conventions in [PullRequestSummaryTab](../../apps/web/src/components/pullRequest/PullRequestSummaryTab.tsx), existing tooltip components, clipboard helpers, and browser opening behavior. The [browser URL helper](../../apps/web/src/browser/openFileInPreview.ts) currently requires a thread reference; standalone PR activation must account for that constraint.
- Comments arrive through the separately loaded [PullRequestActivity](../../packages/contracts/src/pullRequest.ts). Deriving pills must not delay the core PR header, add deployment polling, or duplicate comment requests. Preserve existing handling of incomplete activity data.
- Assumption: the requested hover/right-click interaction targets web and desktop. Native mobile equivalents are not defined by this spec; do not claim mobile parity. Where a client cannot provide the T3 browser, retain its existing unsupported-runtime behavior and keep copying available.

No blocking product questions remain for the web/desktop scope.
