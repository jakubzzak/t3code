# Project home and local library

## Problem and outcome

The project chat entry screen should help users regain context before starting or
resuming work. Replace the empty starting point with a fast, customizable homepage:
a current briefing, recent conversations with live status, and reusable project
documents and links. Uploaded context must remain available across chats.

## Scope

- Project identity, briefing, existing chat composer, and a split workspace for
  recent chats and **Local library**. Preserve the surrounding application shell.
- At most five recent chats and five recent library entries on the homepage, with
  access to the full lists. Saved links count toward the library preview limit.
- File uploads from both the homepage and chat, explicit link saving, background
  processing, right-panel previews, `@` discovery, and agent retrieval.
- Web, desktop, and mobile; connected clients use the library owned by the project's
  environment. On narrow screens, the preview adapts without horizontal overflow.

This does not introduce a general dashboard builder, user-programmed sections,
automatic repository ingestion, cross-project libraries, or a new provider. The
three mockup directions are design references, not three required product modes.

## Required behavior

### Homepage and customization

- Order the page as project identity, briefing, composer, then chats and library.
  Opening it must not wait for AI generation or document processing.
- Show the five most recently opened chats, with title, latest-message or outcome
  preview, and labeled live status. Opening a row resumes that conversation. Status
  updates independently of the briefing; opening a chat determines its recency,
  not background agent activity.
- Show the five most recently added library entries as compact rows: generated
  title, file type or link indicator, concise metadata, and processing status when
  relevant. Keep long summaries and thumbnails out of these default rows.
- Provide full chat and library views; the five-item limit is a homepage display
  limit, not a storage or discovery limit. Empty sections remain useful and allow
  starting a chat or adding an asset.
- Persist project customization: identity/accent, density, section visibility and
  column placement, and briefing focus/instructions. Hidden sections can be restored.
  Status uses consistent colors with text labels, separate from the project accent.

### Briefing

- Summarize current direction, recent changes and activity, relevant files, and
  saved context in a short paragraph with a useful next step. Link substantive
  claims to their supporting thread, change, or asset; do not invent progress.
- On every homepage open, show the cached briefing immediately and check whether
  regeneration is eligible. Start background generation only if no attempt has
  started in the preceding hour, including the first visit with no prior attempt.
  Allow only one in-flight generation per project/environment, shared across tabs
  and devices; a running attempt still blocks another after the hour elapses.
- Count failed attempts toward the hourly limit so repeated opens cannot create a
  retry storm. Opening is the trigger; no periodic generation is required while
  the page remains open. Reopening within the hour reuses the current state.
- Keep the previous briefing readable while refreshing. Use a subtle pulse on a
  small indicator, followed by a short crossfade when the replacement is ready;
  avoid moving the composer. Show a subtle generated timestamp, changing it only
  after successful replacement. Reduced motion uses a static indicator and an
  immediate replacement.
- Without a cached briefing, show a compact preparation state while the rest of
  the homepage works. Failure, missing provider configuration, or loss of
  connection must retain any last successful briefing and explain its stale or
  unavailable state without blocking chat.

### Local library and retention

- Use **Local library** consistently in the homepage, picker, and preview. It is
  project-scoped storage in the owning environment, outside the checkout and Git;
  “local” does not mean browser-only or unavailable to remote clients.
- Every successfully uploaded file is retained in this library, including uploads
  made inside existing chats or unsent drafts. Removing a composer attachment,
  abandoning a draft, closing a chat, or temporary-upload cleanup must not remove
  a retained library original. Partial or rejected transfers are not saved files.
- Keep the original filename and bytes. After saving, process the content and
  generate a meaningful concise title, summary, and labels. Originals remain safe
  if processing fails; show processing/error states and allow processing retry
  without uploading again. Unsupported extraction or preview must be explicit,
  with access to the original instead of fabricated content.
- Only explicitly saved links enter the library. Keep their source URL and process
  accessible content; failed retrieval leaves the saved link available for retry.
  Do not automatically save every URL mentioned in a chat.
- Clicking an entry opens its preview in the right-hand panel while keeping the
  project context available. Show content, summary, labels, and original identity;
  allow adding it to the composer, closing the preview, and returning to the list.
  Previewing or closing a file must not send a message or discard the draft.

### Chat and agent access

- Typing `@` discovers library entries in the existing mention flow under a
  **Local library** label, distinguishable from repository paths. Search the whole
  library by generated title, original filename, and labels, including entries
  outside the five shown on the homepage. Keep existing mention sources working.
- Selecting an entry inserts a stable asset reference. Users can remove the
  reference without removing the original. A changed title must not break existing
  references or resolve to a different file with the same name.
- Agents can discover and retrieve relevant project assets without an explicit
  mention. Expose this through app-owned services/tools, within the destination
  environment and project permissions. Retrieve relevant content on demand rather
  than injecting the entire library into every turn.

## Acceptance criteria

1. With seven chats and eight library entries, the homepage shows five of each in
   the specified order. The full views and `@` search reach the remaining entries.
   Live status changes do not wait for a briefing refresh or reorder opened chats.
2. A recent cached briefing appears without a generation request. After the hourly
   interval, simultaneous opens on two devices start one regeneration and retain
   the old text until success. Failure retains its timestamp and does not permit
   repeated opens to bypass the limit; the next eligible open can retry.
3. A first visit without a briefing, an empty project, and an offline reopen remain
   navigable without fabricated context. Refresh and replacement honor reduced
   motion and do not disrupt the composer.
4. Upload a file through chat, remove it from the unsent draft, and reopen the app.
   Its original remains in Local library and can be mentioned in a different chat.
   Adding a sixth recent file displaces only a homepage row, never the saved file.
5. Processing failure leaves the original accessible and retryable. An unsupported
   preview shows a clear fallback. A saved link remains available when retrieval
   fails. Failed byte transfer does not claim that the file was saved successfully.
6. Clicking a library row opens its right-panel preview; adding it to chat and
   closing the preview preserve the draft. A library file and repository file with
   the same name remain distinguishable. An agent can retrieve the library file
   without a mention and cannot retrieve another project's unauthorized assets.
7. Customization survives reopening and hidden sections can be restored. The same
   project library is usable from desktop, local/hosted web, and mobile over local,
   remote/relay, and tunnel connections; originals never appear in checkout diffs.

## Constraints and decisions

- Tracking exception: proceed without a Linear issue, as explicitly requested.
- Rollout requires a supporting client and server. Older clients retain their
  existing upload behavior; new clients hide library operations on older servers.
  Add storage without rewriting existing attachments or backfilling old uploads.
  Roll back code without deleting library records or originals; re-upgrading must
  recover access. Install the server before upgrading connected clients.
- Prefer the existing environment-owned asset storage and authenticated access
  paths for cross-device use. The Local library label must not introduce a separate
  browser-local store or prevent connected clients from accessing their files.
- Reuse the existing composer, mention sources, attachment transport, and preview
  surfaces. The existing [pending-upload lifecycle](../../packages/client-runtime/src/state/attachments.ts)
  permits expiry and removal; durable library ownership must be independent of it.
  Extend [composer references](../../apps/web/src/composer-editor-mentions.ts) without
  representing library entries as fictitious repository paths.
- Keep wire changes in contracts, shared client behavior in client-runtime, and
  generation, indexing, and retrieval behind server services. UI, MCP, and scheduled
  agents use the same permission-checked operations. Handle provider capability
  differences at adapters and show an explicit limitation where access is unsupported.
- Use bounded briefing inputs and file previews, cached summaries, and background
  processing. Do not scan the full repository or transfer all document bodies on
  every open. Motion must not cause continuous repaints while the page is idle.
- Assumption: use the calm briefing hierarchy with compact file rows as the default;
  retain the existing product typography and shell rather than reproducing the
  illustrative mockup chrome. Exact colors and transition duration are not fixed.
- Assumption: start with uploads made after this feature is enabled; automatic
  backfill of historical chat attachments is outside this scope.

## Open questions

No blocking product questions remain for this scope. Resolve these details during
implementation review without weakening retention or the agreed interactions:

- Which configured provider/model supplies background briefing and metadata work?
  Reuse existing configuration where possible; absence must remain recoverable.
- Which supported formats receive extracted versus native previews? Retaining an
  accepted original must not depend on having a content extractor.
- Explicit library removal and its effect on old chat references need a retention
  policy before destructive cleanup is added. This scope retains originals and
  allows removing chat references; it does not authorize automatic library deletion.
